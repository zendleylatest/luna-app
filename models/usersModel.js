const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
    },
    email: {
      type: String,
      unique: true,
      trim: true,
      lowercase: true,
    },
    profession: {
      type: String,
    },
    password: {
      type: String,
    },
    image: {
      type: String,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
    },
    otp: {
      type: String,
    },
    emailVerified: {
      type: Boolean,
    },
    isGuest: {
      type: Boolean,
      default: false,
      index: true,
    },
    guestKey: {
      type: String,
      unique: true,
      sparse: true,
    },
    androidIdHash: {
      type: String,
      lowercase: true,
      trim: true,
      index: true,
      match: /^[a-f0-9]{64}$/,
    },
    androidId: {
      type: String,
      trim: true,
      index: true,
    },
    pendingBinding: {
      name: { type: String, trim: true },
      email: { type: String, trim: true, lowercase: true },
      password: { type: String },
      otp: { type: String },
      requestedAt: { type: Date },
    },
    googleId: {
      type: String,
    },
    resetOTP: {
      type: String,
    },
    creationsPublic: {
      type: Boolean,
      default: true,
    },
    isBanned: {
      type: Boolean,
      default: false,
      index: true,
    },
    bannedAt: {
      type: Date,
      default: null,
    },
    bannedReason: {
      type: String,
      default: "",
      trim: true,
    },
    deviceTokens: [
      {
        token: {
          type: String,
          required: true,
        },
        deviceType: {
          type: String,
          default: "unknown",
        },
        deviceInfo: {
          os: { type: String, default: "" },
          appVersion: { type: String, default: "" },
        },
        registeredAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    openAiUsage: {
      promptTokens: { type: Number, default: 0 },
      completionTokens: { type: Number, default: 0 },
      totalTokens: { type: Number, default: 0 },
      requestCount: { type: Number, default: 0 },
      lastUsedAt: { type: Date, default: null },
    },
    subscriptionPlan: {
      type: String,
      enum: ["Free", "Premium"],
      default: "Free",
    },
    isPro: {
      type: Boolean,
      default: false,
    },
    subscription: {
      platform: {
        type: String,
        enum: ["android", "ios", "web", "amazon", "none"],
        default: "none",
      },
      productId: { type: String, trim: true },
      purchaseToken: { type: String, trim: true },
      storeUserId: { type: String, trim: true },
      originalTransactionId: { type: String, trim: true },
      status: {
        type: String,
        enum: ["inactive", "active", "expired", "cancelled", "verify_failed", "unsupported"],
        default: "inactive",
      },
      expiresAt: Date,
      lastVerifiedAt: Date,
      source: {
        type: String,
        default: "none",
      },
    },
    careUsage: {
      totalMessagesUsed: {
        type: Number,
        default: 0,
        min: 0,
      },
      updatedAt: Date,
      logsUsed: {
        type: Number,
        default: 0,
        min: 0,
      },
      logsUpdatedAt: Date,
    },
  },
  { timestamps: true }
);

const User = mongoose.model("User", userSchema);

module.exports = User;
