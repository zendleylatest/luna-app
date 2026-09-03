const LunaCycleState = require("../models/lunaCycleStateModel");
const { buildCareLimitConfig } = require("../services/careLimitService");
const {
  buildLogEntitlement,
  incrementLogUsage,
} = require("../services/logLimitService");

function logKeys(state) {
  const logs = state?.logs;
  return logs && typeof logs === "object" && !Array.isArray(logs)
    ? Object.keys(logs)
    : [];
}

async function getLunaCycleState(req, res) {
  try {
    const record = await LunaCycleState.findOne({ userId: req.authUser._id }).lean();
    return res.json({
      state: record?.state || null,
      schemaVersion: record?.schemaVersion || 1,
      updatedAt: record?.updatedAt || null,
    });
  } catch (error) {
    console.error("[luna-cycle:get]", error);
    return res.status(500).json({ error: "Could not load Luna cycle state" });
  }
}

async function saveLunaCycleState(req, res) {
  try {
    const state = req.body?.state;
    if (!state || typeof state !== "object" || Array.isArray(state)) {
      return res.status(400).json({ error: "state object is required" });
    }

    const existing = await LunaCycleState.findOne({
      userId: req.authUser._id,
    }).lean();
    const existingKeys = new Set(logKeys(existing?.state));
    const addedLogs = logKeys(state).filter((key) => !existingKeys.has(key)).length;
    const logEntitlement = await buildLogEntitlement(req.authUser);

    if (
      !logEntitlement.isPro &&
      addedLogs > 0 &&
      logEntitlement.used + addedLogs > logEntitlement.limit
    ) {
      return res.status(402).json({
        code: "LOG_LIMIT_REACHED",
        error: logEntitlement.isGuest
          ? "Guest logging limit reached. Bind your account to continue."
          : "Free logging limit reached. Become Pro to continue.",
        entitlement: {
          isPro: logEntitlement.isPro,
          isGuest: logEntitlement.isGuest,
          limits: buildCareLimitConfig(),
          logs: logEntitlement,
        },
      });
    }

    const record = await LunaCycleState.findOneAndUpdate(
      { userId: req.authUser._id },
      {
        $set: {
          state,
          schemaVersion: Number(req.body.schemaVersion) || 1,
        },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    ).lean();

    if (addedLogs > 0) await incrementLogUsage(req.authUser, addedLogs);
    const updatedLogs = await buildLogEntitlement(req.authUser);

    return res.json({
      state: record.state,
      schemaVersion: record.schemaVersion,
      updatedAt: record.updatedAt,
      entitlement: {
        isPro: updatedLogs.isPro,
        isGuest: updatedLogs.isGuest,
        limits: buildCareLimitConfig(),
        logs: updatedLogs,
      },
    });
  } catch (error) {
    console.error("[luna-cycle:save]", error);
    return res.status(500).json({ error: "Could not save Luna cycle state" });
  }
}

async function deleteLunaCycleState(req, res) {
  try {
    await LunaCycleState.deleteOne({ userId: req.authUser._id });
    return res.json({ ok: true });
  } catch (error) {
    console.error("[luna-cycle:delete]", error);
    return res.status(500).json({ error: "Could not delete Luna cycle state" });
  }
}

module.exports = {
  getLunaCycleState,
  saveLunaCycleState,
  deleteLunaCycleState,
};
