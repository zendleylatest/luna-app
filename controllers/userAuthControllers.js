const bcrypt = require("bcrypt");
const crypto = require("crypto");
const mongoose = require("mongoose");
const { OAuth2Client } = require("google-auth-library");
const { setUser } = require("../services/userAuthService");
const {
  sendOTPEmail,
  sendEmail,
  buildOtpEmailHtml,
  logOtp,
} = require("../services/emailService");
const User = require("../models/usersModel");
const AndroidDeviceUsage = require("../models/androidDeviceUsageModel");
const ChatSession = require("../models/chatModel");
const ChatUsage = require("../models/chatUsageModel");
const PromptGeneration = require("../models/promptGenerationModel");
const PushDeviceToken = require("../models/pushDeviceTokenModel");
const LunaCycleState = require("../models/lunaCycleStateModel");
const {
  NETWORK_ERROR,
  SIGNED_UP,
  SIGN_UP_FAILED,
  USER_NOT_FOUND,
  WRONG_PASSWORD,
  LOGGED_IN,
  ALL_FILEDS_REQUIRED,
  NAME_REQUIRED,
  EMAIL_REQUIRED,
  PASSWORD_REQUIRED,
  OTP_SEND_FAILED,
  INVALID_OTP,
  EMAIL_NOT_VERIFIED,
  USER_ID_OTP_REQUIRED,
} = require("../messages/message");

const googleClient = process.env.GOOGLE_CLIENT_ID
  ? new OAuth2Client(process.env.GOOGLE_CLIENT_ID)
  : null;

const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
const isValidOTP = (otp) => typeof otp === "string" && /^\d{6}$/.test(otp);

function authResponse(user) {
  return {
    token: setUser(user),
    userId: user._id,
    id: user._id,
    username: user.name,
    useremail: user.isGuest ? null : user.email,
    isGuest: user.isGuest === true,
    androidId: user.androidId || null,
    androidIdHash: user.androidIdHash || null,
  };
}

function normalizeAndroidIdHash(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return /^[a-f0-9]{64}$/.test(normalized) ? normalized : null;
}

function normalizeAndroidId(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return /^[a-f0-9]{8,64}$/.test(normalized) ? normalized : null;
}

function readAndroidIdentity(body) {
  const androidId = normalizeAndroidId(body?.androidId);
  const sentHash = normalizeAndroidIdHash(body?.androidIdHash);
  if (!androidId) return { androidId: null, androidIdHash: sentHash };
  const packageName = process.env.ANDROID_PACKAGE_NAME || "com.speckpro.periodtracker.luna.app";
  const calculatedHash = crypto
    .createHash("sha256")
    .update(`${packageName}:${androidId}`)
    .digest("hex");
  if (sentHash && sentHash !== calculatedHash) return null;
  return { androidId, androidIdHash: calculatedHash };
}

function applyAndroidIdentity(user, body) {
  const identity = readAndroidIdentity(body);
  if (!identity) return false;
  if (identity.androidId) user.androidId = identity.androidId;
  if (identity.androidIdHash) user.androidIdHash = identity.androidIdHash;
  return true;
}

function logAuthUser(label, user) {
  console.log(label, {
    userId: user?._id,
    name: user?.name,
    email: user?.email,
    isGuest: user?.isGuest === true,
    androidId: user?.androidId || null,
    androidIdHash: user?.androidIdHash || null,
  });
}

async function findActiveDeviceGuest(device) {
  if (!device) return null;
  if (device.activeGuestUserId) {
    const active = await User.findOne({
      _id: device.activeGuestUserId,
      isGuest: true,
    });
    if (active) return active;
  }
  return User.findOne({
    $or: [
      { androidIdHash: device.androidIdHash },
      ...(device.guestUserIds?.length
        ? [{ _id: { $in: device.guestUserIds } }]
        : []),
    ],
    isGuest: true,
  }).sort({ updatedAt: -1 });
}

async function attachGuestToDevice(user, device) {
  if (!user || !device) return;
  if (
    user.androidIdHash !== device.androidIdHash ||
    (device.androidId && user.androidId !== device.androidId)
  ) {
    user.androidIdHash = device.androidIdHash;
    if (device.androidId) user.androidId = device.androidId;
    await user.save();
  }
  const existingUsed = Number(user?.careUsage?.totalMessagesUsed || 0);
  await AndroidDeviceUsage.updateOne(
    { _id: device._id },
    {
      $set: {
        activeGuestUserId: user._id,
        lastSeenAt: new Date(),
        ...(existingUsed > Number(device?.careUsage?.totalMessagesUsed || 0)
          ? {
              "careUsage.totalMessagesUsed": existingUsed,
              "careUsage.updatedAt": new Date(),
            }
          : {}),
      },
      $addToSet: { guestUserIds: user._id },
    }
  );
}

async function handleCreateGuest(req, res) {
  try {
    const guestKey = String(req.body?.guestKey || "").trim();
    const identity = readAndroidIdentity(req.body);
    if (!identity) {
      return res.status(400).json({ error: "Android device identity does not match its hash" });
    }
    const { androidId, androidIdHash } = identity;
    if (!androidIdHash && (guestKey.length < 16 || guestKey.length > 200)) {
      return res.status(400).json({
        error: "A valid Android device identity or guest key is required",
      });
    }

    let device = null;
    let user = null;
    if (androidIdHash) {
      device = await AndroidDeviceUsage.findOneAndUpdate(
        { androidIdHash },
        {
          $set: {
            lastSeenAt: new Date(),
            ...(androidId ? { androidId } : {}),
          },
          $setOnInsert: { androidIdHash },
        },
        { new: true, upsert: true }
      );
      user = await findActiveDeviceGuest(device);
    }
    if (!user && guestKey.length >= 16 && guestKey.length <= 200) {
      user = await User.findOne({
        guestKey,
        isGuest: true,
        ...(androidIdHash
          ? {
              $or: [
                { androidIdHash },
                { androidIdHash: null },
                { androidIdHash: { $exists: false } },
              ],
            }
          : {}),
      });
    }
    if (!user) {
      user = await User.create({
        name: "Guest",
        email: `guest_${crypto.randomUUID()}@luna.invalid`,
        emailVerified: false,
        isGuest: true,
        ...(guestKey ? { guestKey } : {}),
        ...(androidIdHash ? { androidIdHash } : {}),
        ...(androidId ? { androidId } : {}),
        creationsPublic: false,
      });
    }
    await attachGuestToDevice(user, device);
    logAuthUser("[guest device]", user);

    return res.status(201).json(authResponse(user));
  } catch (err) {
    console.error("create guest error:", err);
    return res.status(500).json({ error: NETWORK_ERROR });
  }
}

async function handleRestoreGuest(req, res) {
  try {
    const identity = readAndroidIdentity(req.body);
    if (!identity) {
      return res.status(400).json({ error: "Android device identity does not match its hash" });
    }
    const { androidId, androidIdHash } = identity;
    if (!androidIdHash) {
      return res.status(400).json({ error: "A valid Android device identity is required" });
    }

    const device = await AndroidDeviceUsage.findOne({ androidIdHash });
    if (!device) {
      return res.status(404).json({ registered: false });
    }
    if (androidId && device.androidId !== androidId) {
      device.androidId = androidId;
      device.lastSeenAt = new Date();
      await device.save();
    }

    const user = await findActiveDeviceGuest(device);
    if (!user) {
      device.lastSeenAt = new Date();
      await device.save();
      return res.status(404).json({
        registered: true,
        usage: {
          totalMessagesUsed: Number(device?.careUsage?.totalMessagesUsed || 0),
        },
      });
    }

    await attachGuestToDevice(user, device);
    logAuthUser("[guest restore]", user);
    return res.json({ registered: true, ...authResponse(user) });
  } catch (err) {
    console.error("restore guest error:", err);
    return res.status(500).json({ error: NETWORK_ERROR });
  }
}

async function handleUpdateGuestDevice(req, res) {
  try {
    const user = req.authUser;
    if (!user?.isGuest) {
      return res.status(409).json({ error: "Only guest sessions can change guest devices" });
    }

    const identity = readAndroidIdentity(req.body);
    if (!identity?.androidIdHash || !identity.androidId) {
      return res.status(400).json({ error: "A valid Android device identity is required" });
    }

    const previousAndroidId = normalizeAndroidId(req.body?.previousAndroidId);
    if (previousAndroidId && user.androidId && previousAndroidId !== user.androidId) {
      return res.status(409).json({ error: "The saved Android device does not match this guest" });
    }

    const previousHash = user.androidIdHash || null;
    if (previousHash === identity.androidIdHash) {
      user.androidId = identity.androidId;
      await user.save();
      const device = await AndroidDeviceUsage.findOneAndUpdate(
        { androidIdHash: identity.androidIdHash },
        {
          $set: {
            androidId: identity.androidId,
            activeGuestUserId: user._id,
            lastSeenAt: new Date(),
          },
          $addToSet: { guestUserIds: user._id },
        },
        { new: true, upsert: true }
      );
      await attachGuestToDevice(user, device);
      return res.json(authResponse(user));
    }

    const targetDevice = await AndroidDeviceUsage.findOne({
      androidIdHash: identity.androidIdHash,
    });
    if (targetDevice) {
      const targetGuest = await findActiveDeviceGuest(targetDevice);
      if (targetGuest && targetGuest._id.toString() !== user._id.toString()) {
        return res.status(409).json({
          error: "This Android device is already linked to another guest",
        });
      }
    }

    let device = targetDevice;
    const previousDevice = previousHash
      ? await AndroidDeviceUsage.findOne({ androidIdHash: previousHash })
      : null;
    if (!device && previousDevice) {
      previousDevice.androidId = identity.androidId;
      previousDevice.androidIdHash = identity.androidIdHash;
      previousDevice.activeGuestUserId = user._id;
      previousDevice.lastSeenAt = new Date();
      if (!previousDevice.guestUserIds.some((id) => id.toString() === user._id.toString())) {
        previousDevice.guestUserIds.push(user._id);
      }
      device = await previousDevice.save();
    } else if (!device) {
      device = await AndroidDeviceUsage.create({
        androidId: identity.androidId,
        androidIdHash: identity.androidIdHash,
        activeGuestUserId: user._id,
        guestUserIds: [user._id],
      });
    } else {
      await attachGuestToDevice(user, device);
      if (previousDevice && previousDevice._id.toString() !== device._id.toString()) {
        await AndroidDeviceUsage.updateOne(
          { _id: previousDevice._id, activeGuestUserId: user._id },
          { $set: { activeGuestUserId: null, lastSeenAt: new Date() } }
        );
      }
    }

    user.androidId = identity.androidId;
    user.androidIdHash = identity.androidIdHash;
    await user.save();
    await attachGuestToDevice(user, device);
    logAuthUser("[guest device changed]", user);
    return res.json(authResponse(user));
  } catch (err) {
    console.error("update guest device error:", err);
    return res.status(500).json({ error: NETWORK_ERROR });
  }
}

async function handleBindGuestAccount(req, res) {
  try {
    const user = req.authUser;
    if (!user?.isGuest) {
      return res.status(409).json({ error: "This account is already bound" });
    }

    const name = String(req.body?.name || "").trim();
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");
    if (name.length < 2) return res.status(400).json({ error: NAME_REQUIRED });
    if (!isValidEmail(email)) {
      return res.status(400).json({ error: "Invalid email format" });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters" });
    }

    const existing = await User.exists({ email, _id: { $ne: user._id } });
    if (existing) {
      return res.status(409).json({ error: "User already exists" });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const hashed = await bcrypt.hash(password, 10);
    await sendOTPEmail(email, otp);

    user.pendingBinding = {
      name,
      email,
      password: hashed,
      otp,
      requestedAt: new Date(),
    };
    await user.save();

    return res.status(200).json({
      message: "Verification code sent. Your guest data will be preserved.",
      userId: user._id,
    });
  } catch (err) {
    console.error("bind guest account error:", err);
    return res.status(500).json({ error: OTP_SEND_FAILED });
  }
}

async function handleUserSignUp(req, res) {
  const body = req.body;
  if (!body) return res.status(400).json({ message: ALL_FILEDS_REQUIRED });
  if (!body.name) return res.status(400).json({ message: NAME_REQUIRED });
  if (!body.email) return res.status(400).json({ message: EMAIL_REQUIRED });
  if (!body.password) return res.status(400).json({ message: PASSWORD_REQUIRED });

  try {
    const email = String(body.email).trim().toLowerCase();
    const identity = readAndroidIdentity(body);
    if (!identity) {
      return res.status(400).json({ error: "Android device identity does not match its hash" });
    }
    const hashed = await bcrypt.hash(body.password, 10);
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    const result = await User.create({
      name: body.name,
      email,
      profession: body.profession ?? undefined,
      password: hashed,
      image: req.file ? `/uploads/${req.file.filename}` : null,
      otp,
      emailVerified: false,
      ...(identity.androidId ? { androidId: identity.androidId } : {}),
      ...(identity.androidIdHash ? { androidIdHash: identity.androidIdHash } : {}),
    });

    try {
      await sendOTPEmail(email, otp);
    } catch (mailErr) {
      console.error("OTP email error:", mailErr);
      await User.findByIdAndDelete(result._id);
      return res.status(500).json({ error: OTP_SEND_FAILED });
    }

    logAuthUser("[user signup]", result);

    res.status(201).json({
      message: "User created. OTP sent to email.",
      userId: result._id,
      success: SIGNED_UP,
    });
  } catch (err) {
    console.error("DB create error:", err);
    res.status(500).json({ error: SIGN_UP_FAILED });
  }
}

async function handleVerifyOTP(req, res) {
  try {
    const { userId, otp } = req.body;
    if (
      userId == null ||
      otp === undefined ||
      otp === null ||
      String(otp).trim() === ""
    ) {
      return res.status(400).json({ error: USER_ID_OTP_REQUIRED });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(400).json({ error: USER_NOT_FOUND });
    }

    const pendingBinding = user.pendingBinding;
    if (pendingBinding?.otp) {
      const requestedAt = pendingBinding.requestedAt
        ? new Date(pendingBinding.requestedAt).getTime()
        : 0;
      if (!requestedAt || Date.now() - requestedAt > 15 * 60 * 1000) {
        user.pendingBinding = undefined;
        await user.save();
        return res.status(400).json({ error: "Verification code expired" });
      }
      if (pendingBinding.otp !== String(otp).trim()) {
        return res.status(400).json({ error: INVALID_OTP });
      }

      const existing = await User.exists({
        email: pendingBinding.email,
        _id: { $ne: user._id },
      });
      if (existing) {
        return res.status(409).json({ error: "User already exists" });
      }

      user.name = pendingBinding.name;
      user.email = pendingBinding.email;
      user.password = pendingBinding.password;
      user.emailVerified = true;
      user.isGuest = false;
      user.guestKey = undefined;
      user.pendingBinding = undefined;
      user.otp = null;
      await user.save();

      if (user.androidIdHash) {
        await AndroidDeviceUsage.updateOne(
          { androidIdHash: user.androidIdHash, activeGuestUserId: user._id },
          { $set: { activeGuestUserId: null, lastSeenAt: new Date() } }
        );
      }

      return res.json({
        message: "Guest account bound successfully.",
        bound: true,
        ...authResponse(user),
      });
    }

    if (user.otp !== String(otp).trim()) {
      return res.status(400).json({ error: INVALID_OTP });
    }

    user.emailVerified = true;
    user.otp = null;
    await user.save();

    res.json({ message: "Email verified successfully." });
  } catch (err) {
    console.error("verify OTP error:", err);
    res.status(500).json({ error: NETWORK_ERROR });
  }
}

async function handleUserLogin(req, res) {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");

    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ error: USER_NOT_FOUND });
    if (user.isBanned) {
      return res.status(403).json({
        error: "Your account is banned. Please contact support.",
        bannedReason: user.bannedReason || "",
      });
    }

    if (user.emailVerified === false) {
      return res.status(400).json({ error: EMAIL_NOT_VERIFIED });
    }

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(400).json({ error: WRONG_PASSWORD });
    if (!applyAndroidIdentity(user, req.body)) {
      return res.status(400).json({ error: "Android device identity does not match its hash" });
    }
    await user.save();
    const token = setUser(user);

    res.json({
      success: LOGGED_IN,
      userId: user._id,
      token: token,
      username: user.name,
      useremail: user.email,
    });
  } catch (err) {
    res.status(500).json({ error: NETWORK_ERROR });
  }
}

async function handleGoogleLogin(req, res) {
  try {
    if (!googleClient || !process.env.GOOGLE_CLIENT_ID) {
      return res.status(500).json({ error: "Google sign-in is not configured" });
    }
    const { idToken } = req.body;
    if (!idToken) {
      return res.status(400).json({ error: "Google ID token required" });
    }

    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    if (!payload || !payload.email) {
      return res.status(400).json({ error: "Invalid Google token" });
    }

    const { sub, email, name, email_verified, picture } = payload;

    let user = await User.findOne({ email });

    if (!user) {
      user = await User.create({
        name: name || "Google User",
        email,
        googleId: sub,
        emailVerified: email_verified !== false,
        image: picture || undefined,
      });
    } else {
      let updated = false;
      if (!user.googleId) {
        user.googleId = sub;
        updated = true;
      }
      if (!user.image && picture) {
        user.image = picture;
        updated = true;
      }
      if (!user.emailVerified && email_verified) {
        user.emailVerified = true;
        updated = true;
      }
      if (updated) await user.save();
    }

    if (user.isBanned) {
      return res.status(403).json({
        error: "Your account is banned. Please contact support.",
        bannedReason: user.bannedReason || "",
      });
    }

    const token = setUser(user);
    res.json({
      token,
      id: user._id,
    });
  } catch (err) {
    console.error("Google login error:", err.message);
    res.status(500).json({ error: "Google authentication failed" });
  }
}

async function handleGetProfile(req, res) {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid user ID" });
    }

    const user = await User.findById(id).select(
      "-otp -resetOTP -password -emailVerified -guestKey -pendingBinding"
    );
    if (!user) return res.status(404).json({ error: "User not found" });

    const o = user.toObject();
    o.fullName = o.name;
    res.json(o);
  } catch (err) {
    console.error("getProfile error:", err);
    res.status(500).json({ error: NETWORK_ERROR });
  }
}

async function handleUpdateProfile(req, res) {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid user ID" });
    }

    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (req.body.newPassword && !req.body.oldPassword) {
      return res.status(400).json({ message: "Old password required" });
    }

    if (req.body.oldPassword && req.body.newPassword) {
      const ok = await bcrypt.compare(req.body.oldPassword, user.password || "");
      if (!ok) {
        return res.status(400).json({ message: "Old password is incorrect" });
      }
    }

    const updates = {};
    const displayName = req.body.fullName ?? req.body.name;
    if (displayName) updates.name = displayName;
    if (req.body.newPassword) {
      updates.password = await bcrypt.hash(req.body.newPassword, 10);
    }
    if (req.file) {
      updates.image = `/uploads/profile/${req.file.filename}`;
    }

    const cp = req.body.creationsPublic;
    if (cp !== undefined && cp !== null && cp !== "") {
      if (cp === true || cp === "true" || cp === "1") {
        updates.creationsPublic = true;
      } else if (cp === false || cp === "false" || cp === "0") {
        updates.creationsPublic = false;
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ message: "No data to update" });
    }

    await User.findByIdAndUpdate(id, updates, { new: true });
    res.json("Your Information Updated");
  } catch (err) {
    console.error("updateProfile error:", err);
    res.status(500).json({ message: "Server error" });
  }
}

async function handleDeleteAccount(req, res) {
  try {
    const user = req.authUser;
    if (!user?._id) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (!applyAndroidIdentity(user, req.body)) {
      return res.status(400).json({ error: "Android device identity does not match its hash" });
    }
    await user.save();

    const userId = user._id;
    const userEmail = user.email ? user.email.toString().trim().toLowerCase() : "";

    await Promise.all([
      ChatSession.deleteMany({ userId }),
      ChatUsage.deleteMany({ userId }),
      PromptGeneration.deleteMany({
        $or: [
          { userId },
          ...(userEmail ? [{ generatedBy: userEmail }] : []),
        ],
      }),
      PushDeviceToken.deleteMany({ userId: userId.toString() }),
      LunaCycleState.deleteOne({ userId }),
      ...(user.androidIdHash
        ? [
            AndroidDeviceUsage.updateOne(
              { androidIdHash: user.androidIdHash, activeGuestUserId: userId },
              { $set: { activeGuestUserId: null, lastSeenAt: new Date() } }
            ),
          ]
        : []),
    ]);

    await User.deleteOne({ _id: userId });

    res.json({
      message: "Account permanently deleted.",
    });
  } catch (err) {
    console.error("deleteAccount error:", err);
    res.status(500).json({ error: NETWORK_ERROR });
  }
}

async function handleForgotPassword(req, res) {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: "Email required" });
    }
    if (!isValidEmail(email)) {
      return res.status(400).json({ error: "Invalid email format" });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    user.resetOTP = otp;
    await user.save();

    logOtp(email, otp, "password reset");
    await sendEmail(
      email,
      "Reset your Luna App password",
      `Your Luna App password reset code is: ${otp}`,
      {
        html: buildOtpEmailHtml({
          title: "Reset your password",
          preheader: `Your Luna App password reset code is ${otp}.`,
          otp,
          message:
            "Use this one-time code to reset your Luna App password and get back into your account.",
        }),
      }
    );
    res.json({ message: "OTP sent" });
  } catch (err) {
    console.error("forgotPassword error:", err);
    res.status(500).json({ error: NETWORK_ERROR });
  }
}

async function handleResetPassword(req, res) {
  try {
    const { email, otp, newPassword } = req.body;
    if (!email || !otp || !newPassword) {
      return res.status(400).json({ error: "All fields required" });
    }
    if (!isValidOTP(String(otp).trim())) {
      return res.status(400).json({ error: "Invalid OTP format" });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters" });
    }

    const user = await User.findOne({ email, resetOTP: String(otp).trim() });
    if (!user) {
      return res.status(400).json({ error: "Invalid OTP" });
    }

    user.password = await bcrypt.hash(newPassword, 10);
    user.resetOTP = null;
    await user.save();

    res.json({ message: "Password reset successful" });
  } catch (err) {
    console.error("resetPassword error:", err);
    res.status(500).json({ error: NETWORK_ERROR });
  }
}

module.exports = {
  handleCreateGuest,
  handleRestoreGuest,
  handleUpdateGuestDevice,
  handleBindGuestAccount,
  handleUserSignUp,
  handleUserLogin,
  handleVerifyOTP,
  handleGoogleLogin,
  handleGetProfile,
  handleUpdateProfile,
  handleDeleteAccount,
  handleForgotPassword,
  handleResetPassword,
};
