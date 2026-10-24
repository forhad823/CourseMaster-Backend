// validation schemas for authentication

const { z } = require("zod");

const email = z.string().trim().toLowerCase().email();

const registerSchema = z.object({
  name: z.string().trim().min(2),
  email,
  password: z.string().min(6),
  adminKey: z.string().optional(), // Optional admin registration key
});

const loginSchema = z.object({
  email,
  password: z.string().min(6),
});

module.exports = { registerSchema, loginSchema };
