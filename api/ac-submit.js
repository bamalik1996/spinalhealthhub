export default async function handler(req, res) {

  res.setHeader(
    "Access-Control-Allow-Origin",
    "https://spinal-health-hub.webflow.io"
  );

  res.setHeader(
    "Access-Control-Allow-Methods",
    "POST, OPTIONS"
  );

  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type"
  );

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({
      ok: false,
      error: "Method not allowed"
    });
  }

  try {

    const body = req.body;

    const response = await fetch(
      "https://spinalhealthhub.api-us1.com/api/3/contact/sync",
      {
        method: "POST",
        headers: {
          "Api-Token": process.env.AC_API_KEY,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          contact: {
            email: body.email
          }
        })
      }
    );

    const data = await response.json();

    return res.status(200).json({
      ok: true,
      data
    });

  } catch (err) {

    return res.status(500).json({
      ok: false,
      error: err.message
    });

  }
}