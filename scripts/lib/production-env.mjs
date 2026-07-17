const MIN_SECRET_BYTES = 32;

function byteLength(value) {
  return Buffer.byteLength(value || "", "utf8");
}

function validUrl(value, protocols) {
  try {
    const url = new URL(value);
    return protocols.includes(url.protocol);
  } catch {
    return false;
  }
}

export function validateProductionEnvironment(env) {
  const issues = [];
  const requireValue = (key) => {
    if (!env[key]?.trim()) issues.push(`${key}: chưa được cấu hình.`);
  };
  const requireSecret = (key) => {
    if (byteLength(env[key]) < MIN_SECRET_BYTES) {
      issues.push(`${key}: phải có ít nhất ${MIN_SECRET_BYTES} byte.`);
    }
  };

  requireValue("DATABASE_URL");
  requireValue("DIRECT_URL");
  if (env.DATABASE_URL && !validUrl(env.DATABASE_URL, ["postgres:", "postgresql:"])) {
    issues.push("DATABASE_URL: phải là PostgreSQL URL hợp lệ.");
  }
  if (env.DIRECT_URL && !validUrl(env.DIRECT_URL, ["postgres:", "postgresql:"])) {
    issues.push("DIRECT_URL: phải là PostgreSQL URL hợp lệ.");
  }

  requireSecret("AUTH_SECRET");
  requireSecret("TOKEN_ENCRYPTION_KEY");
  requireSecret("CRON_SECRET");
  if (env.AUTH_SECRET && env.TOKEN_ENCRYPTION_KEY === env.AUTH_SECRET) {
    issues.push("TOKEN_ENCRYPTION_KEY: phải khác AUTH_SECRET.");
  }
  if (env.INITIAL_SETUP_SECRET && byteLength(env.INITIAL_SETUP_SECRET) < MIN_SECRET_BYTES) {
    issues.push(`INITIAL_SETUP_SECRET: nếu sử dụng phải có ít nhất ${MIN_SECRET_BYTES} byte.`);
  }

  requireValue("APP_URL");
  if (env.APP_URL && !validUrl(env.APP_URL, ["https:"])) {
    issues.push("APP_URL: production phải dùng URL HTTPS hợp lệ.");
  }

  for (const key of ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REDIRECT_URI"]) {
    requireValue(key);
  }
  if (env.GOOGLE_REDIRECT_URI && !validUrl(env.GOOGLE_REDIRECT_URI, ["https:"])) {
    issues.push("GOOGLE_REDIRECT_URI: production phải dùng URL HTTPS hợp lệ.");
  }
  if (env.APP_URL && env.GOOGLE_REDIRECT_URI) {
    try {
      const expected = new URL("/api/gmail/callback", env.APP_URL).toString();
      if (new URL(env.GOOGLE_REDIRECT_URI).toString() !== expected) {
        issues.push(`GOOGLE_REDIRECT_URI: phải bằng ${expected}`);
      }
    } catch {
      // The dedicated URL checks above already report the invalid value.
    }
  }

  requireValue("NQ_TAX_CODE");
  if (env.NQ_TAX_CODE && !/^\d{10}(?:\d{3})?$/.test(env.NQ_TAX_CODE.replace(/\D/g, ""))) {
    issues.push("NQ_TAX_CODE: phải là mã số thuế 10 hoặc 13 chữ số.");
  }

  requireValue("SUPABASE_URL");
  requireSecret("SUPABASE_SERVICE_ROLE_KEY");
  requireValue("SUPABASE_STORAGE_BUCKET");
  if (env.SUPABASE_URL && !validUrl(env.SUPABASE_URL, ["https:"])) {
    issues.push("SUPABASE_URL: phải là URL HTTPS hợp lệ.");
  }
  if (env.SUPABASE_STORAGE_BUCKET && !/^[a-z0-9][a-z0-9._-]{1,62}$/i.test(env.SUPABASE_STORAGE_BUCKET)) {
    issues.push("SUPABASE_STORAGE_BUCKET: tên bucket không hợp lệ.");
  }

  return issues;
}
