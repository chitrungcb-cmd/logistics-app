import "dotenv/config";
import {
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";

const dryRun = process.argv.includes("--dry-run");
const prefixArg = process.argv.find((value) => value.startsWith("--prefix="));
const rootPrefix = (prefixArg?.slice("--prefix=".length) || "attachments").replace(/^\/+|\/+$/g, "");

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Thiếu biến môi trường ${name}.`);
  return value;
}

const supabaseUrl = required("SUPABASE_URL").replace(/\/$/, "");
const supabaseKey = required("SUPABASE_SERVICE_ROLE_KEY");
const supabaseBucket = process.env.SUPABASE_STORAGE_BUCKET?.trim() || "logistics-attachments";
const accountId = required("R2_ACCOUNT_ID");
const r2Bucket = required("R2_BUCKET_NAME");
const r2 = new S3Client({
  region: "auto",
  endpoint:
    process.env.R2_ENDPOINT?.trim().replace(/\/$/, "") ||
    `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: required("R2_ACCESS_KEY_ID"),
    secretAccessKey: required("R2_SECRET_ACCESS_KEY"),
  },
});

const supabaseHeaders = {
  apikey: supabaseKey,
  Authorization: `Bearer ${supabaseKey}`,
};

function encodePath(value) {
  return value.split("/").map(encodeURIComponent).join("/");
}

async function listFolder(prefix) {
  const rows = [];
  let offset = 0;
  while (true) {
    const response = await fetch(
      `${supabaseUrl}/storage/v1/object/list/${encodeURIComponent(supabaseBucket)}`,
      {
        method: "POST",
        headers: { ...supabaseHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({
          prefix,
          limit: 1_000,
          offset,
          sortBy: { column: "name", order: "asc" },
        }),
      }
    );
    if (!response.ok) {
      throw new Error(`Không thể liệt kê Supabase Storage (${response.status}): ${await response.text()}`);
    }
    const page = await response.json();
    if (!Array.isArray(page)) throw new Error("Supabase Storage trả về danh sách không hợp lệ.");
    rows.push(...page);
    if (page.length < 1_000) break;
    offset += page.length;
  }
  return rows;
}

async function collectObjectKeys(prefix) {
  const keys = [];
  const rows = await listFolder(prefix);
  for (const row of rows) {
    if (!row || typeof row.name !== "string") continue;
    const key = prefix ? `${prefix}/${row.name}` : row.name;
    const isFolder = row.id == null && row.metadata == null;
    if (isFolder) keys.push(...(await collectObjectKeys(key)));
    else keys.push(key);
  }
  return keys;
}

function r2Status(error) {
  if (error instanceof S3ServiceException) return error.$metadata.httpStatusCode;
  if (error && typeof error === "object" && "$metadata" in error) {
    return error.$metadata?.httpStatusCode;
  }
  return undefined;
}

async function existsInR2(key) {
  try {
    await r2.send(new HeadObjectCommand({ Bucket: r2Bucket, Key: key }));
    return true;
  } catch (error) {
    if (r2Status(error) === 404 || error?.name === "NotFound" || error?.name === "NoSuchKey") {
      return false;
    }
    throw error;
  }
}

async function downloadSupabaseObject(key) {
  const response = await fetch(
    `${supabaseUrl}/storage/v1/object/${encodeURIComponent(supabaseBucket)}/${encodePath(key)}`,
    { headers: supabaseHeaders }
  );
  if (!response.ok) {
    throw new Error(`Không thể đọc ${key} từ Supabase (${response.status}): ${await response.text()}`);
  }
  return {
    body: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get("content-type") || "application/octet-stream",
  };
}

const keys = await collectObjectKeys(rootPrefix);
console.log(`Tìm thấy ${keys.length} tệp trong Supabase Storage dưới ${rootPrefix}/.`);

let skipped = 0;
let copied = 0;
for (const [index, key] of keys.entries()) {
  if (await existsInR2(key)) {
    skipped += 1;
  } else if (dryRun) {
    copied += 1;
    console.log(`[Xem trước] Sẽ chuyển: ${key}`);
  } else {
    const source = await downloadSupabaseObject(key);
    await r2.send(
      new PutObjectCommand({
        Bucket: r2Bucket,
        Key: key,
        Body: source.body,
        ContentType: source.contentType,
        CacheControl: "private, no-store",
      })
    );
    copied += 1;
  }

  if ((index + 1) % 25 === 0 || index + 1 === keys.length) {
    console.log(`Đã kiểm tra ${index + 1}/${keys.length}: chuyển ${copied}, bỏ qua ${skipped}.`);
  }
}

if (dryRun) {
  console.log("Đây là chế độ xem trước; chưa tệp nào được ghi vào R2.");
} else {
  console.log("Hoàn tất. Tệp nguồn trên Supabase được giữ nguyên làm bản dự phòng.");
}
