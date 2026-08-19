const scenarios = {
  qualified: { name: "Sarah Miller", email: "sarah@example.com", company: "Bright Path Coaching", subject: "Landing page for September launch", message: "We are launching a group coaching program in September and need a landing page plus email signup. Our budget is around $2,000. Can you help, and what would you need from us?" },
  incomplete: { name: "James Chen", email: "james@example.com", company: "JC Advisory", subject: "Website help", message: "Hi, I found your work through a colleague. Our consulting website feels outdated and I would like to understand how you could help us." },
  spam: { name: "SEO Partner", email: "outreach@example.com", company: "Rank Rocket", subject: "Guaranteed SEO guest post partnership", message: "We guarantee first-page rankings. Buy 500 backlinks and guest posts today. Contact us on Telegram for a special crypto discount." },
};

const staticDemo = location.hostname.endsWith("github.io") || new URLSearchParams(location.search).has("static-demo");
const form = document.querySelector("#lead-form");
const button = document.querySelector("#submit");
const errorBox = document.querySelector("#error");
const copyButton = document.querySelector("#copy-reply");
const contactForm = document.querySelector("#contact-form");
const contactButton = document.querySelector("#contact-submit");
const contactStatus = document.querySelector("#contact-status");

document.querySelector("#year").textContent = new Date().getFullYear();
document.querySelector("#contact-started-at").value = String(Date.now());

if (staticDemo) {
  document.querySelector("#mode").textContent = "static demo · no API cost";
} else {
  fetch("/api/health")
    .then((response) => response.json())
    .then((data) => { document.querySelector("#mode").textContent = `${data.mode} mode · ${data.model}`; })
    .catch(() => { document.querySelector("#mode").textContent = "Demo mode"; });
}

document.querySelectorAll(".scenario-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".scenario-tab").forEach((item) => item.classList.remove("active"));
    tab.classList.add("active");
    loadScenario(tab.dataset.scenario);
  });
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  setLoading(true);
  errorBox.textContent = "";
  try {
    const body = Object.fromEntries(new FormData(form));
    const analysis = staticDemo ? await analyzeStaticDemo(body) : await analyzeWithServer(body);
    renderResult(analysis);
  } catch (error) {
    errorBox.textContent = error.message;
  } finally {
    setLoading(false);
  }
});

copyButton.addEventListener("click", async () => {
  await navigator.clipboard.writeText(document.querySelector("#reply").textContent);
  copyButton.textContent = "Copied";
  setTimeout(() => { copyButton.textContent = "Copy draft"; }, 1400);
});

contactForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  contactStatus.className = "contact-status";
  contactStatus.textContent = "";
  contactButton.disabled = true;
  contactButton.querySelector("span").textContent = "Saving your request…";

  try {
    const body = Object.fromEntries(new FormData(contactForm));
    const endpoint = staticDemo
      ? "https://leadpilot-ai-6db.pages.dev/api/inquiries"
      : "/api/inquiries";
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Your request could not be saved.");

    contactForm.reset();
    document.querySelector("#contact-started-at").value = String(Date.now());
    contactStatus.className = "contact-status success";
    contactStatus.textContent = `Request received. Your reference is ${payload.reference || "confirmed"}. We’ll review it and reply by email.`;
  } catch (error) {
    contactStatus.className = "contact-status error";
    contactStatus.textContent = error.message;
  } finally {
    contactButton.disabled = false;
    contactButton.querySelector("span").textContent = "Request my workflow audit";
  }
});

async function analyzeWithServer(body) {
  const response = await fetch("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "The analysis could not be completed.");
  return payload.analysis;
}

async function analyzeStaticDemo(lead) {
  if (!lead.name || !lead.email || !lead.message) throw new Error("Name, email, and message are required.");
  await new Promise((resolve) => setTimeout(resolve, 320));

  const text = `${lead.subject || ""} ${lead.message}`.toLowerCase();
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
  const businessName = "LeadPilot AI";
  return {
    qualificationScore: spam ? 8 : budgetMatch ? 91 : urgent ? 78 : 62,
    priority,
    intent,
    summary: spam ? "Likely unsolicited promotion or spam." : `${lead.name} from ${lead.company || "an unspecified company"} is asking about ${lead.subject || "a potential project"}.`,
    recommendedAction: spam ? "Archive without replying." : support ? "Route to a human before replying." : missingInformation.length ? "Ask for the missing project details, then schedule a short discovery call." : "Review the scope and invite the lead to a discovery call.",
    needsHuman: support || !spam,
    missingInformation,
    replySubject: `Re: ${lead.subject || "Your inquiry"}`,
    replyDraft: spam ? "No reply recommended." : `Hi ${lead.name},\n\nThanks for reaching out to ${businessName}. Your project sounds interesting. ${missingInformation.length ? `Before we recommend the right next step, could you share your ${missingInformation.join(", ").toLowerCase()}?` : "We would be happy to review the details and discuss the next step."}\n\nBest,\n${businessName}`,
  };
}

function loadScenario(key) {
  const scenario = scenarios[key];
  for (const [field, value] of Object.entries(scenario)) form.elements[field].value = value;
  document.querySelector("#result").style.display = "none";
  document.querySelector("#empty").style.display = "grid";
}

function setLoading(loading) {
  button.disabled = loading;
  button.querySelector("span").textContent = loading ? "Analyzing intent and fit…" : "Analyze this lead";
}

function renderResult(result) {
  document.querySelector("#empty").style.display = "none";
  document.querySelector("#result").style.display = "block";
  document.querySelector("#score").textContent = result.qualificationScore;
  document.querySelector("#score-ring").style.setProperty("--score", result.qualificationScore);
  document.querySelector("#verdict").textContent = verdictFor(result);
  const priority = document.querySelector("#priority");
  priority.textContent = `${result.priority} priority`;
  priority.className = `priority-${result.priority}`;
  document.querySelector("#intent").textContent = result.intent;
  document.querySelector("#human").textContent = result.needsHuman ? "review required" : "safe to archive";
  document.querySelector("#summary").textContent = result.summary;
  document.querySelector("#action").textContent = result.recommendedAction;
  document.querySelector("#missing").textContent = result.missingInformation.length ? result.missingInformation.join(" · ") : "No obvious gaps";
  document.querySelector("#reply-subject").textContent = result.replySubject;
  document.querySelector("#reply").textContent = result.replyDraft;
  document.querySelector("#result").animate([{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "none" }], { duration: 350, easing: "ease-out" });
}

function verdictFor(result) {
  if (result.intent === "spam") return "Archive safely";
  if (result.priority === "high") return "Strong potential fit";
  if (result.missingInformation.length) return "Clarify before routing";
  return "Review and follow up";
}

const observer = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) {
      entry.target.classList.add("visible");
      observer.unobserve(entry.target);
    }
  });
}, { threshold: 0.08 });

document.querySelectorAll(".reveal").forEach((element) => observer.observe(element));
loadScenario("qualified");
