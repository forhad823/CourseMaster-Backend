const dotenv = require("dotenv");
dotenv.config();

const app = require("./src/app");
const connectDB = require("./src/config/db");

// const seedDatabase = require("./seed.js");

const PORT = process.env.PORT || 5000;

// FIX (BUG-024): fail fast instead of starting a server that cannot sign/verify tokens
if (!process.env.JWT_SECRET) {
  console.error("JWT_SECRET missing in .env - refusing to start");
  process.exit(1);
}

connectDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
      // seedDatabase();
    });
  })
  .catch((err) => {
    console.error("DB connection failed:", err.message);
    // Exit instead of leaving a half-started process hanging
    process.exit(1);
  });
