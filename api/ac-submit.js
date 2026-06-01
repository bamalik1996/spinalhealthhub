/* =========================================================
   ActiveCampaign submission handler
   — syncs contact, adds to list, applies tag, sets custom fields
   ========================================================= */

// ── List ID ───────────────────────────────────────────────
const LIST_ID = 4; // Back-Type Quiz Leads

// ── Field name → ID cache (populated at runtime) ──────────
let fieldIdCache = null;

async function getFieldIds(acBase, acHeaders) {
  if (fieldIdCache) return fieldIdCache;

  const res = await fetch(`${acBase}/fields?limit=100`, {
    method: "GET",
    headers: acHeaders,
  });
  const data = await res.json();

  const map = {};
  for (const f of (data.fields || [])) {
    map[f.perstag.toLowerCase()] = f.id;
    map[f.title.toLowerCase()]   = f.id;
  }

  fieldIdCache = map;
  return map;
}

export default async function handler(req, res) {

  res.setHeader(
    "Access-Control-Allow-Origin",
    "https://spinal-health-hub.webflow.io"
  );
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const AC_BASE = "https://spinalhealthhub.api-us1.com/api/3";
  const AC_HEADERS = {
    "Api-Token": process.env.AC_API_KEY,
    "Content-Type": "application/json",
  };

  try {
    const { email, tag, confidence, runnerUp, margin } = req.body;

    if (!email) {
      return res.status(400).json({ ok: false, error: "email is required" });
    }

    // ── 1. Resolve custom field IDs by name ──────────────
    const fields = await getFieldIds(AC_BASE, AC_HEADERS);

    // AC personalization tags are stored uppercased; titles are as-created.
    // We index both lowercased so either form matches.
    const idConfidence = fields["confidence"]  || fields["%confidence%"];
    const idRunnerUp   = fields["runner-up"]   || fields["%runner-up%"]  || fields["runnerup"];
    const idMargin     = fields["margin"]      || fields["%margin%"];

    const fieldValues = [];
    if (idConfidence) fieldValues.push({ field: String(idConfidence), value: confidence ?? "" });
    if (idRunnerUp)   fieldValues.push({ field: String(idRunnerUp),   value: runnerUp  ?? "" });
    if (idMargin)     fieldValues.push({ field: String(idMargin),     value: margin != null ? String(margin) : "" });

    // ── 2. Sync contact (upsert) ──────────────────────────
    const syncRes = await fetch(`${AC_BASE}/contact/sync`, {
      method: "POST",
      headers: AC_HEADERS,
      body: JSON.stringify({
        contact: {
          email: email.trim(),
          fieldValues,
        },
      }),
    });

    const syncData = await syncRes.json();

    if (!syncRes.ok) {
      return res.status(502).json({ ok: false, error: "contact/sync failed", detail: syncData });
    }

    const contactId = syncData?.contact?.id;

    if (!contactId) {
      return res.status(502).json({ ok: false, error: "No contact ID returned from sync", detail: syncData });
    }

    // ── 3. Add contact to list ────────────────────────────
    const listRes = await fetch(`${AC_BASE}/contactLists`, {
      method: "POST",
      headers: AC_HEADERS,
      body: JSON.stringify({
        contactList: {
          list:    LIST_ID,
          contact: contactId,
          status:  1, // 1 = subscribed
        },
      }),
    });

    const listData = await listRes.json();

    if (!listRes.ok) {
      console.error("contactLists failed:", listData);
      // Non-fatal — continue to tag step
    }

    // ── 4. Apply subtype tag ──────────────────────────────
    let tagResult = null;

    if (tag) {
      // First, resolve (or create) the tag to get its ID
      const tagSearchRes = await fetch(
        `${AC_BASE}/tags?search=${encodeURIComponent(tag)}`,
        { method: "GET", headers: AC_HEADERS }
      );
      const tagSearchData = await tagSearchRes.json();

      let tagId = tagSearchData?.tags?.[0]?.id ?? null;

      if (!tagId) {
        // Tag doesn't exist yet — create it
        const createTagRes = await fetch(`${AC_BASE}/tags`, {
          method: "POST",
          headers: AC_HEADERS,
          body: JSON.stringify({ tag: { tag, tagType: "contact", description: "" } }),
        });
        const createTagData = await createTagRes.json();
        tagId = createTagData?.tag?.id ?? null;
      }

      if (tagId) {
        const applyTagRes = await fetch(`${AC_BASE}/contactTags`, {
          method: "POST",
          headers: AC_HEADERS,
          body: JSON.stringify({
            contactTag: { contact: contactId, tag: tagId },
          }),
        });
        tagResult = await applyTagRes.json();
      }
    }

    return res.status(200).json({
      ok: true,
      contactId,
      fieldsMapped: { idConfidence, idRunnerUp, idMargin },
      listData,
      tagResult,
    });

  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}
