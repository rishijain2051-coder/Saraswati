import dotenv from 'dotenv';

dotenv.config();

export const env = {
  PORT: parseInt(process.env.PORT || '4000', 10),
  JWT_SECRET: process.env.JWT_SECRET || 'saraswati-dev-secret',
  NODE_ENV: process.env.NODE_ENV || 'development',
};
