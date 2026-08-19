export async function onRequestPost({ request }) {
  try {
    const lead = validateLead(await request.json());
    const analysis = analyzeDemo(lead);

    return Response.json({
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      mode: "edge-demo",
      model: "cloudflare-rules",
      lead,
      analysis,
    });
  } catch (error) {
    return Response.json(
      { error: error.message || "The lead could not be analyzed." },
      { status: error.statusCode || 400 },
    );
  }
}

export function onRequest() {
  return Response.json({ error: "Method not allowed" }, { status: 405 });
}

function validateLead(input) {
  if (!input || typeof input !== "object") badRequest("Please submit a valid lead.");
  const clean = {};
  for (const field of ["name", "email", "company", "subject", "message", "source"]) {
    clean[field] = String(input[field] || "").trim();
  }
  if (!clean.name) badRequest("Name is required.");
  if (!clean.email || !/^\S+@\S+\.\S+$/.test(clean.email)) badRequest("A valid email is required.");
  if (!clean.message) badRequest("Message is required.");
  if (clean.message.length > 6000) badRequest("Message must be under 6,000 characters.");
  return clean;
}

function analyzeDemo(lead) {
  const text = `${lead.subject} ${lead.message}`.toLowerCase();
  const normalizedText = text.replace(/,(?=\d{3}\b)/g, "");
  const spam = /(crypto|casino|backlink|guest post|guaranteed seo|telegram)/i.test(text);
  const support = /(refund|broken|not working|complaint|support)/i.test(text);
  const urgent = /(urgent|asap|this week|immediately)/i.test(text);
  const budgetMatch = /\$\s?(1[0-9]{3}|[2-9][0-9]{3,})|budget.{0,8}(1[0-9]{3}|[2-9][0-9]{3,})/i.test(normalizedText);
  const missingInformation = [];
  if (!/(budget|\$|usd)/i.test(text)) missingInformation.push("Budget range");
  if (!/(week|month|deadline|launch|date)/i.test(text)) missingInformation.push("Target launch date");
  if (!/(page|website|landing|refresh)/i.test(text)) missingInformation.push("Required deliverables");

  const intent = spam ? "spam" : support ? "support" : "sales";
  const priority = spam ? "low" : budgetMatch || urgent ? "high" : "medium";
  const businessName = "Northstar Web Studio";

  return {
    qualificationScore: spam ? 8 : budgetMatch ? 91 : urgent ? 78 : 62,
    priority,
    intent,
    summary: spam
      ? "Likely unsolicited promotion or spam."
      : `${lead.name} from ${lead.company || "an unspecified company"} is asking about ${lead.subject || "a potential project"}.`,
    recommendedAction: spam
      ? "Archive without replying."
      : support
        ? "Route to a human before replying."
        : missingInformation.length
          ? "Ask for the missing project details, then schedule a short discovery call."
          : "Review the scope and invite the lead to a discovery call.",
    needsHuman: support || !spam,
    missingInformation,
    replySubject: `Re: ${lead.subject || "Your inquiry"}`,
    replyDraft: spam
      ? "No reply recommended."
      : `Hi ${lead.name},\n\nThanks for reaching out to ${businessName}. Your project sounds interesting. ${missingInformation.length ? `Before we recommend the right next step, could you share your ${missingInformation.join(", ").toLowerCase()}?` : "We would be happy to review the details and discuss the next step."}\n\nBest,\n${businessName}`,
  };
}

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  throw error;
}
