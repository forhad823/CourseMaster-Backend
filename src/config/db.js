// database connection configuration

const mongoose = require("mongoose");
const dns = require("dns");

// Prefer IPv4 for normal hostname lookups (dns.lookup)
if (dns.setDefaultResultOrder) {
  dns.setDefaultResultOrder("ipv4first");
}

// FIX (BUG-001): `mongodb+srv://` URIs trigger a DNS SRV query via Node's
// c-ares resolver (dns.resolveSrv), which does NOT use the setDefaultResultOrder
// setting above. Many ISP/router/VPN DNS servers refuse SRV lookups, which causes
// "querySrv ECONNREFUSED". Forcing reliable public DNS servers fixes it.
// Override with DNS_SERVERS in .env (comma separated) if needed.
try {
  const servers = (process.env.DNS_SERVERS || "8.8.8.8,1.1.1.1,8.8.4.4")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  dns.setServers(servers);
} catch (err) {
  console.warn("Could not set custom DNS servers:", err.message);
}

// Cache the connection to reuse in serverless environments
let cachedConnection = null;
// Share one in-flight attempt so app.js and server.js don't connect twice
let connectingPromise = null;

const connectDB = async () => {
  // If already connected, return the cached connection
  if (cachedConnection && mongoose.connection.readyState === 1) {
    return cachedConnection;
  }

  const uri = process.env.MONGODB_URI || process.env.MONGO_URI; // Support both
  if (!uri) throw new Error("MONGODB_URI or MONGO_URI missing in .env");

  // If an attempt is already in progress, wait for that same attempt
  if (connectingPromise) return connectingPromise;

  connectingPromise = mongoose
    .connect(uri, {
      serverSelectionTimeoutMS: 10000, // fail after 10s instead of 30s
      socketTimeoutMS: 45000, // Close sockets after 45s of inactivity
      family: 4, // use IPv4 for the actual socket connection
    })
    .then((connection) => {
      cachedConnection = connection;
      console.log("MongoDB Connected ✅");
      return connection;
    })
    .catch((error) => {
      console.error("MongoDB connection error:", error.message);
      throw error;
    })
    .finally(() => {
      connectingPromise = null;
    });

  return connectingPromise;
};

module.exports = connectDB;
