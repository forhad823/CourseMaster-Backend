// middleware to validate request bodies against Zod schemas

const validate = (schema) => (req, res, next) => {
  try {
    req.body = schema.parse(req.body);
    next();
  } catch (err) {
    // FIX (BUG-011): Zod v4 exposes `issues` (the old `errors` property no longer exists)
    if (Array.isArray(err.issues)) {
      return res.status(400).json({
        message: "Validation error",
        errors: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      });
    }
    next(err);
  }
};

module.exports = validate;
