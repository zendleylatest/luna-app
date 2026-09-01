const mongoose = require("mongoose");

const lunaCycleStateSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
      required: true,
      unique: true,
      index: true,
    },
    state: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    schemaVersion: {
      type: Number,
      default: 1,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("LunaCycleState", lunaCycleStateSchema);
