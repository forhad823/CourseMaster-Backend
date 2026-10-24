// authentication service

const crypto = require("crypto");
const bcrypt = require("bcrypt");
const User = require("../models/User");
const generateToken = require("../utils/generateToken");
const httpError = require("../utils/httpError");
const { sendWelcomeEmail } = require("./email.service");

// constant-time string comparison (hashes first so lengths always match)
const safeEqual = (a, b) => {
  const ha = crypto.createHash("sha256").update(String(a)).digest();
  const hb = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
};

const register = async ({ name, email, password, adminKey }) => {
  const normalizedEmail = String(email).trim().toLowerCase();

  const exists = await User.findOne({ email: normalizedEmail });
  if (exists) throw httpError(400, "Email already registered");
  
  // becomes admin by presenting the secret ADMIN_REGISTRATION_KEY from the server's env.
  let role = "student";
  if (adminKey !== undefined && adminKey !== "") {
    const expected = process.env.ADMIN_REGISTRATION_KEY;
    if (!expected || !safeEqual(adminKey, expected)) {
      throw httpError(403, "Invalid admin registration key");
    }
    role = "admin";
  }

  const passwordHash = await bcrypt.hash(password, 10);

  let user;
  try {
    user = await User.create({ name, email: normalizedEmail, passwordHash, role });
  } catch (err) {
    // two simultaneous sign-ups with the same e-mail: the unique index wins
    if (err.code === 11000) throw httpError(400, "Email already registered");
    throw err;
  }

  const token = generateToken({ id: user._id, role: user.role });

  // Send welcome email (non-blocking - don't wait for it)
  sendWelcomeEmail(user.email, user.name).catch((err) => {
    console.error("Email sending failed (non-critical):", err.message);
  });

  return {
    token,
    user: { id: user._id, name: user.name, email: user.email, role: user.role },
  };
};

const login = async ({ email, password }) => {
  const user = await User.findOne({ email: String(email).trim().toLowerCase() });
  if (!user) throw httpError(400, "Invalid email or password");


  const match = await bcrypt.compare(password, user.passwordHash);
  if (!match) throw httpError(400, "Invalid email or password");

  if (user.isBanned) throw httpError(403, "Your account has been banned");

  const token = generateToken({ id: user._id, role: user.role });

  return {
    token,
    user: { id: user._id, name: user.name, email: user.email, role: user.role },
  };
};

const getMe = async (userId) => {
  const user = await User.findById(userId).select("-passwordHash");
  if (!user) throw httpError(404, "User not found");
  return user;
};

module.exports = { register, login, getMe };
