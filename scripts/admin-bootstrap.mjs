export class AdminBootstrapInputError extends Error {
  constructor(message) {
    super(message);
    this.name = "AdminBootstrapInputError";
  }
}

/** @param {Record<string, string | undefined>} [env] */
export function readAdminBootstrapConfig(env = process.env) {
  const required = ["MONGODB_URI", "ADMIN_NAME", "ADMIN_EMAIL", "ADMIN_PASSWORD"];
  const missing = required.filter((key) => !env[key]?.trim());
  if (missing.length) {
    throw new AdminBootstrapInputError(`Missing required environment variables: ${missing.join(", ")}.`);
  }

  const mongoUri = (env.MONGODB_URI ?? "").trim();
  const name = (env.ADMIN_NAME ?? "").trim();
  const email = (env.ADMIN_EMAIL ?? "").trim().toLowerCase();
  const password = env.ADMIN_PASSWORD ?? "";

  if (!mongoUri.startsWith("mongodb://") && !mongoUri.startsWith("mongodb+srv://")) {
    throw new AdminBootstrapInputError("MONGODB_URI must be a MongoDB connection URI.");
  }
  if (name.length < 2 || name.length > 120) {
    throw new AdminBootstrapInputError("ADMIN_NAME must be between 2 and 120 characters.");
  }
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new AdminBootstrapInputError("ADMIN_EMAIL must be a valid email address.");
  }
  if (password.length < 14 || password.length > 200) {
    throw new AdminBootstrapInputError("ADMIN_PASSWORD must be between 14 and 200 characters.");
  }

  return { mongoUri, name, email, password };
}

export async function initializeAdmin({ StaffUser, config, hashPassword }) {
  const emailLookup = {
    email: {
      $regex: `^${config.email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
      $options: "i",
    },
  };
  if (await StaffUser.exists(emailLookup)) {
    return { created: false };
  }

  await StaffUser.collection.createIndex({ email: 1 }, { unique: true });
  if (await StaffUser.exists(emailLookup)) {
    return { created: false };
  }

  try {
    await StaffUser.create({
      name: config.name,
      email: config.email,
      passwordHash: await hashPassword(config.password, 12),
      role: "SUPER_ADMIN",
      active: true,
      sessionVersion: 0,
    });
  } catch (error) {
    if (error?.code === 11000 && await StaffUser.exists(emailLookup)) {
      return { created: false };
    }
    throw error;
  }

  return { created: true };
}
