import  {ApiError} from '../utils/errorHandler.js';

const errorHandler = (err, req, res, next) => {
  console.error(" Error:", err);

  // ========================
  //  Mongoose Validation
  // ========================
  if (err.name === "ValidationError") {
    const errors = Object.values(err.errors).map(e => e.message);

    return res.status(400).json({
      success: false,
      code: 400,
      message: "Validation Error",
      errors: errors,
      data: null,
    });
  }

  // ========================
  //  Cast Error (invalid ID)
  // ========================
  if (err.name === "CastError") {
    return res.status(400).json({
      success: false,
      code: 400,
      message: `Invalid ${err.path}: ${err.value}`,
      data: null,
    });
  }

  // ========================
  //  Duplicate Key
  // ========================
  if (err.code === 11000) {
    const fields = Object.entries(err.keyValue || {})
      .map(([key, value]) => `${key}: ${value}`)
      .join(', ');

    return res.status(409).json({
      success: false,
      code: 409,
      message: `A record with the same ${fields} already exists.`,
      data: null,
    });
  }

  // ========================
  //  Custom ApiError
  // ========================
  if (err instanceof ApiError) {
    return res.status(err.statusCode).json({
      success: false,
      code: err.statusCode,
      message: err.message,
      data: null,
    });
  }

  // ========================
  //  Razorpay SDK Error
  //  Razorpay throws plain objects like { statusCode: 406, error: { description: '...' } }
  //  They are NOT instances of Error so they fall through to here.
  // ========================
  if (err && err.statusCode && !err.message) {
    const rzpDesc =
      err.error?.description ||
      err.error?.reason ||
      err.description ||
      `Razorpay API error (${err.statusCode})`;

    console.error('[errorHandler] Razorpay SDK error:', JSON.stringify(err));

    return res.status(err.statusCode < 600 ? err.statusCode : 500).json({
      success: false,
      code: err.statusCode,
      message: rzpDesc,
      data: null,
    });
  }

  // ========================
  //  Final fallback
  // ========================
  return res.status(500).json({
    success: false,
    code: 500,
    message: err.message || "Something went wrong",
    data: null,
  });
};

export default errorHandler;