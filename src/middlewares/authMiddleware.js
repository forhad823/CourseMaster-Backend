// middleware to authenticate JWT tokens

const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { isObjectId } = require("../utils/objectId");

const authMiddleware = async (req, res, next) => {
  const header = req.headers.authorization;
  if (!header) {
    return res.status(401).json({ message: "Not authorized" });
  }

  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : header.trim();

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
  
    return res.status(401).json({ message: "Invalid or expired token" });
  }

  try {
    const user = isObjectId(String(decoded.id))
      ? await User.findById(decoded.id).select("role isBanned")
      : null;
    if (!user) return res.status(401).json({ message: "Not authorized" });
    if (user.isBanned) return res.status(403).json({ message: "Your account has been banned" });

    req.user = { id: String(user._id), role: user.role };
    next();
  } catch (err) {
    next(err);
  }
};

module.exports = authMiddleware;
