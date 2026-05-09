import {
  S3Client,
  PutObjectCommand,
} from "@aws-sdk/client-s3";

import fs from "fs";
import path from "path";

const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const uploadOnS3 = async ({
  localFilePath,
  mimetype,
  folder = "uploads",
  originalname,
}) => {
  try {
    if (!localFilePath) return null;

    const fileContent = fs.readFileSync(localFilePath);

    const ext = path.extname(originalname);

    const key = `${folder}/${Date.now()}-${Math.random()
      .toString(36)
      .substring(2)}${ext}`;

    const command = new PutObjectCommand({
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: key,
      Body: fileContent,
      ContentType: mimetype,
    });

    await s3.send(command);

    const fileUrl = `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;

    if (fs.existsSync(localFilePath)) {
      fs.unlinkSync(localFilePath);
    }

    return {
      secure_url: fileUrl,
      key,
    };
  } catch (error) {
    console.error("S3 Upload Error:", error);

    if (fs.existsSync(localFilePath)) {
      fs.unlinkSync(localFilePath);
    }

    return null;
  }
};

export { uploadOnS3 };