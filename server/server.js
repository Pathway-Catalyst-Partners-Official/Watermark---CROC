const express = require('express');
const multer = require('multer');
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
const Papa = require('papaparse');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();
const upload = multer({ dest: 'uploads/' });
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

app.post('/submit', upload.fields([
  { name: 'to' }, 
  { name: 'logo' }, 
  { name: 'pdf' }
]), async (req, res) => {
  try {
    const fromEmail = req.body.email;
    const text = req.body.text;
    const content = req.body.content;

    const csvFile = req.files['to'][0];
    const logoFile = req.files['logo'][0];
    const pdfFiles = req.files['pdf'];

    // ✅ Validate total size of PDFs
    const totalSize = pdfFiles.reduce((sum, file) => sum + file.size, 0);
    if (totalSize > 25 * 1024 * 1024) {
      return res.status(400).send('❌ Total uploaded PDFs exceed 25MB.');
    }

    // ✅ Fetch app password from Supabase
    const { data: creds, error: credErr } = await supabase
      .from('email_credentials')
      .select('app_password')
      .eq('from_email', fromEmail)
      .single();

    if (credErr || !creds) {
      return res.status(401).send('❌ Unauthorized: Email not found in database.');
    }

    const appPassword = creds.app_password;
    const csvText = fs.readFileSync(csvFile.path, 'utf8');
    const parsed = Papa.parse(csvText, { header: true, skipEmptyLines: true });
    const logoBuffer = fs.readFileSync(logoFile.path);

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.SMTP_USER,
        pass: appPassword
      }
    });

    for (const row of parsed.data) {
      const to = row['email address'];
      const cc = row['cc'] || '';
      const lenderName = row['lender name'] || 'Lender';

      if (!to) continue;

      const attachments = [];

      for (const pdfFile of pdfFiles) {
        const pdfBuffer = fs.readFileSync(pdfFile.path);
        const watermarkedPdf = await addWatermark(pdfBuffer, logoBuffer, text, lenderName);
        const tempPath = path.join(__dirname, '../uploads', `${Date.now()}_${lenderName}_${pdfFile.originalname}`);
        fs.writeFileSync(tempPath, watermarkedPdf);
        attachments.push({ filename: `Watermarked_${lenderName}_${pdfFile.originalname}`, path: tempPath });
      }

      const mailOptions = {
        from: `"${fromEmail}" <${process.env.SMTP_USER}>`,
        to,
        cc: cc.split(',').map(c => c.trim()).filter(Boolean),
        subject: `Deal for ${lenderName}`,
        text: content,
        attachments
      };

      await transporter.sendMail(mailOptions);
      console.log(`✅ Sent to ${to}`);
      attachments.forEach(a => fs.unlinkSync(a.path));
    }

    res.send('✅ All emails sent.');
  } catch (err) {
    console.error(err);
    res.status(500).send('❌ Error processing request.');
  } finally {
    Object.values(req.files).flat().forEach(file => fs.unlinkSync(file.path));
  }
});

async function addWatermark(pdfBuffer, logoBuffer, text, lenderName) {
  const pdfDoc = await PDFDocument.load(pdfBuffer);
  const logoImage = await pdfDoc.embedPng(logoBuffer);
  const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const logoDims = logoImage.scale(0.25);

  for (const page of pdfDoc.getPages()) {
    const { width, height } = page.getSize();
    page.drawImage(logoImage, { x: 50, y: height - 80, width: logoDims.width, height: logoDims.height });
    page.drawText(`${text} - ${lenderName}`, {
      x: 50,
      y: 50,
      size: 12,
      font,
      color: rgb(0.7, 0.7, 0.7),
      opacity: 0.4
    });
  }

  return await pdfDoc.save();
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));
