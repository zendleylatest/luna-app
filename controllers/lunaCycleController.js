const LunaCycleState = require("../models/lunaCycleStateModel");

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

    return res.json({
      state: record.state,
      schemaVersion: record.schemaVersion,
      updatedAt: record.updatedAt,
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
