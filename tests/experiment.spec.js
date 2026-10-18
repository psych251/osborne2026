// End-to-end test: a robot participant runs the whole experiment.
//
// Two modes:
//   - Emulator mode (EMULATOR=1, set automatically by `npm test`): data must land in the
//     local Firestore emulator, the security rules must reject forbidden requests, and
//     client errors must be logged.
//   - Offline mode (plain `npx playwright test`): the experiment must still run to the end
//     and offer the JSON download fallback.
//
// If you change the timeline in experiment.js, update `runThroughExperiment` below so the
// robot still knows which buttons to press. That is a feature: the test documents the flow.

const { test, expect, devices } = require("@playwright/test");

const EMULATOR = process.env.EMULATOR === "1" || !!process.env.FIRESTORE_EMULATOR_HOST;
const PROJECT = "demo-psych251";
const EXPERIMENT_ID = "osborne2026-pilot-a";
const FS = `http://localhost:8080/v1/projects/${PROJECT}/databases/(default)/documents`;

async function runUpToDebrief(page) {
  // 1. consent
  await page.getByRole("button", { name: "I agree to participate" }).click();
  // 2. instructions (two pages)
  await page.locator("#jspsych-instructions-next").click();
  await page.locator("#jspsych-instructions-next").click();
  // 3. demographics (SurveyJS): stage, age, education years, knowledge, HRT, feeling, social media use
  await page.locator('[data-name="menopause_stage"]').getByText("Post menopause - not had a period", { exact: false }).click();
  await page.locator('[data-name="age"] input').fill("34");
  await page.locator('[data-name="education_years"] input').fill("4");
  await page.locator('[data-name="knowledge"]').getByText("Moderately knowledgeable", { exact: true }).click();
  await page.locator('[data-name="hrt"]').getByText("No, I have never", { exact: false }).click();
  await page.locator('[data-name="feeling_post"]').getByText("It was fine", { exact: true }).click();
  await page.locator('[data-name="social_media_use"]').getByText("Daily", { exact: true }).click();
  await page.locator('input[value="Continue"]').click();
  // 4. the 4 posts together on one page (the 60 s wait is skipped in emulator/test runs)
  await expect(page.getByText("Please read the following social media posts")).toBeVisible();
  await expect(page.locator(".post img")).toHaveCount(4);
  await page.getByRole("button", { name: "Continue" }).click();
  // 4b. the message-type question comes right after the posts, before the ratings
  await page.locator('[data-name="message_type"]').getByText("Positive", { exact: true }).click();
  await page.locator('input[value="Continue"]').click();
  // 5. four rating pages (answer "4th option" on every item), then the views page
  const likertPage = async (text, n) => {
    await expect(page.getByText(text)).toBeVisible();
    for (let q = 0; q < n; q++) await page.locator(`input[name="Q${q}"][value="3"]`).check();
    await page.locator("#jspsych-survey-likert-next").click();
  };
  await likertPage("to what extent do you agree", 5);
  await likertPage("to what extent do you feel the following", 6);
  await likertPage("how likely would you be to take the following action", 5);
  await likertPage("how likely would you be to discuss", 2);
  for (const q of ["fit_own_views", "rep_social_media", "rep_media", "rep_health_professionals"]) {
    await page.locator(`[data-name="${q}"]`).getByText("Neither agree nor disagree", { exact: true }).click();
  }
  await page.locator('input[value="Continue"]').click();
  // 6. feedback
  await expect(page.getByText("How clear were the instructions?")).toBeVisible();
  await page.locator('input[name="Q0"][value="4"]').check();
  await page.locator("#jspsych-survey-likert-next").click();
  await page.locator("textarea").fill("Robot participant says hi.");
  await page.locator("#jspsych-survey-text-next").click();
}

async function runThroughExperiment(page) {
  await runUpToDebrief(page);
  // 7. debrief
  await page.getByRole("button", { name: "Finish" }).click();
  await expect(page.getByText("All done")).toBeVisible({ timeout: 30000 });
}

async function fsGet(path) {
  // "Bearer owner" is the emulator's admin token: it bypasses security rules, like the Admin SDK.
  const r = await fetch(`${FS}/${path}`, { headers: { Authorization: "Bearer owner" } });
  return { status: r.status, body: r.status === 200 ? await r.json() : null };
}

// Unwrap Firestore REST "fields" encoding into plain JS.
function decode(v) {
  if (v == null) return null;
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("nullValue" in v) return null;
  if ("timestampValue" in v) return v.timestampValue;
  if ("mapValue" in v) return decodeFields(v.mapValue.fields || {});
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(decode);
  return v;
}
function decodeFields(fields) {
  const out = {};
  for (const k of Object.keys(fields)) out[k] = decode(fields[k]);
  return out;
}

test.describe("experiment", () => {
  test("runs to the end and saves data", async ({ page }) => {
    const consoleErrors = [];
    page.on("pageerror", (e) => consoleErrors.push(String(e)));

    await page.goto(EMULATOR ? "/?emulator=1&PROLIFIC_PID=robot123&STUDY_ID=s1&SESSION_ID=sess1" : "/");
    await page.waitForFunction(() => window.__saver && window.__saver.uid);
    const mode = await page.evaluate(() => window.__saver.mode);
    expect(mode).toBe(EMULATOR ? "emulator" : "offline");

    await runThroughExperiment(page);

    // No uncaught errors from the experiment itself.
    expect(consoleErrors, "uncaught page errors").toEqual([]);

    const uid = await page.evaluate(() => window.__saver.docId);
    const stats = await page.evaluate(() => window.__saver.stats);

    if (!EMULATOR) {
      // Offline: banner + download fallback, nothing else to check.
      await expect(page.locator("#data-saver-banner")).toHaveAttribute("data-kind", "offline");
      await expect(page.locator("#data-saver-fallback")).toBeVisible();
      return;
    }

    expect(stats.writes_failed).toBe(0);
    await expect(page.locator("#data-saver-fallback")).toHaveCount(0);

    // Participant document is complete and carries condition + Prolific ids.
    const p = await fsGet(`experiments/${EXPERIMENT_ID}/participants/${uid}`);
    expect(p.status).toBe(200);
    const pdoc = decodeFields(p.body.fields);
    expect(pdoc.completed).toBe(true);
    expect(["normal", "distress"]).toContain(pdoc.condition);
    expect(pdoc.prolific_pid).toBe("robot123");
    expect(pdoc.n_trials).toBeGreaterThan(10);
    expect(typeof pdoc.full_data).toBe("string");
    const full = JSON.parse(pdoc.full_data);
    expect(full.length).toBe(pdoc.n_trials);

    // One chunk per trial (chunk_size = 1), each carrying the trial data.
    const chunks = await fsGet(`experiments/${EXPERIMENT_ID}/participants/${uid}/trials?pageSize=500`);
    expect(chunks.status).toBe(200);
    const docs = (chunks.body.documents || []).map((d) => decodeFields(d.fields));
    expect(docs.length).toBe(pdoc.n_trials);
    const trials = docs.flatMap((d) => d.trials);
    const posts = trials.filter((t) => t.task === "posts");
    expect(posts.length).toBe(1);
    expect(posts[0].condition).toBe(pdoc.condition);
    expect(posts[0].post_images.split(",").length).toBe(4);
    expect(posts[0].post_images).toContain(`images/${pdoc.condition}_1.jpg`);
    expect(trials.find((t) => t.task === "ratings_agree").response.liked).toBe(3);
    expect(trials.find((t) => t.task === "ratings_feel").response.worried).toBe(3);
    expect(trials.find((t) => t.task === "ratings_action").response.like).toBe(3);
    expect(trials.find((t) => t.task === "ratings_discuss").response.discuss_friends_family).toBe(3);
    expect(trials.find((t) => t.task === "messaging").response.message_type).toBe("Positive");
    const demo = trials.find((t) => t.task === "demographics");
    expect(demo.response.age).toBe(34);

    // Every trial row must carry the same participant id as its participant document,
    // otherwise trials.csv and participants.csv cannot be joined in the analysis.
    expect([...new Set(trials.map((t) => t.participant_id))]).toEqual([uid]);
  });

  test("chunked writes (chunk_size > 1) save every trial", async ({ page }) => {
    test.skip(!EMULATOR, "needs the Firestore emulator");
    await page.goto("/?emulator=1&chunk_size=5");
    await page.waitForFunction(() => window.__saver && window.__saver.uid);
    await runThroughExperiment(page);
    const uid = await page.evaluate(() => window.__saver.docId);
    const p = decodeFields((await fsGet(`experiments/${EXPERIMENT_ID}/participants/${uid}`)).body.fields);
    const chunks = await fsGet(`experiments/${EXPERIMENT_ID}/participants/${uid}/trials?pageSize=500`);
    const docs = (chunks.body.documents || []).map((d) => decodeFields(d.fields));
    expect(docs.length).toBe(Math.ceil(p.n_trials / 5));
    const indices = docs.flatMap((d) => d.trials).map((t) => t.trial_index).sort((a, b) => a - b);
    expect(indices).toEqual([...Array(p.n_trials).keys()]);
  });

  test("declining consent ends the study without a thank-you-for-your-data message", async ({ page }) => {
    await page.goto(EMULATOR ? "/?emulator=1" : "/");
    await page.waitForFunction(() => window.__saver && window.__saver.uid);
    await page.getByRole("button", { name: "I do not agree" }).click();
    await expect(page.getByText("You chose not to participate")).toBeVisible({ timeout: 15000 });
    await expect(page.getByText("Your responses were saved")).toHaveCount(0);
  });

  test("losing the connection at the end offers the download fallback instead of hanging", async ({ page, context }) => {
    test.skip(!EMULATOR, "needs the Firestore emulator");
    test.setTimeout(120000);
    // Run the real flow up to the last click, then cut the connection before "Finish".
    await page.goto("/?emulator=1");
    await page.waitForFunction(() => window.__saver && window.__saver.uid);
    await runUpToDebrief(page);
    await context.setOffline(true);
    await page.getByRole("button", { name: "Finish" }).click();
    await expect(page.locator("#data-saver-fallback")).toBeVisible({ timeout: 40000 });
    await expect(page.getByText("connection to the server was lost")).toBeVisible();
    await expect(page.getByText("Your responses were saved")).toHaveCount(0);
    await context.setOffline(false);
  });

  test("a second run in the same browser is a new participant and saves cleanly", async ({ page }) => {
    test.skip(!EMULATOR, "needs the Firestore emulator");
    test.setTimeout(120000);

    const ids = [];
    for (let run = 0; run < 2; run++) {
      // Same page/context both times: the anonymous auth session persists, exactly as it
      // does for a student testing twice in one browser or a participant who reloads.
      await page.goto("/?emulator=1&PROLIFIC_PID=rerun" + run);
      await page.waitForFunction(() => window.__saver && window.__saver.docId);
      await runThroughExperiment(page);
      const info = await page.evaluate(() => ({
        uid: window.__saver.uid, docId: window.__saver.docId, stats: window.__saver.stats,
      }));
      expect(info.stats.writes_failed, "run " + run + " had failed writes").toBe(0);
      await expect(page.locator("#data-saver-fallback")).toHaveCount(0);
      ids.push(info);
    }

    expect(ids[0].uid).toBe(ids[1].uid);          // same browser, same anonymous identity
    expect(ids[0].docId).not.toBe(ids[1].docId);  // but a separate participant record

    // Both runs survive intact, with their own Prolific id and their own trials.
    for (let run = 0; run < 2; run++) {
      const p = await fsGet(`experiments/${EXPERIMENT_ID}/participants/${ids[run].docId}`);
      expect(p.status).toBe(200);
      const pdoc = decodeFields(p.body.fields);
      expect(pdoc.completed, "run " + run + " completed").toBe(true);
      expect(pdoc.prolific_pid).toBe("rerun" + run);
      const chunks = await fsGet(`experiments/${EXPERIMENT_ID}/participants/${ids[run].docId}/trials?pageSize=500`);
      expect((chunks.body.documents || []).length).toBe(pdoc.n_trials);
    }
  });

  test("setting a Prolific completion code does not break the test run", async ({ page }) => {
    // Regression test for the failure students hit right before launch: with a completion
    // code set, the live page redirects to Prolific, but a test run must stay put so that
    // `npm test` and CI keep passing.
    const navigations = [];
    page.on("framenavigated", (f) => { if (f === page.mainFrame()) navigations.push(f.url()); });

    await page.goto(EMULATOR ? "/?emulator=1&cc=QA123CODE" : "/?cc=QA123CODE");
    await page.waitForFunction(() => window.__saver && window.__saver.docId);
    await runThroughExperiment(page);

    expect(navigations.some((u) => u.includes("prolific.com")), "must not navigate to Prolific").toBe(false);
    if (EMULATOR) await expect(page.getByText("QA123CODE")).toBeVisible();
  });

  test("phones and tablets are allowed in (requires_keyboard is false for this study)", async ({ browser }) => {
    // This study uses only buttons and typed numbers, so EXPERIMENT.requires_keyboard is false
    // and a phone sees the consent page instead of the "Please use a computer" message.
    const context = await browser.newContext({ ...devices["iPhone 13"] });
    const page = await context.newPage();
    await page.goto("http://localhost:8017/?emulator=1");
    await expect(page.getByRole("button", { name: "I agree to participate" })).toBeVisible({ timeout: 20000 });
    await expect(page.locator("#device-unsupported")).toHaveCount(0);

    if (EMULATOR) {
      await page.waitForFunction(() => window.__saver && window.__saver.docId);
      const docId = await page.evaluate(() => window.__saver.docId);
      await page.evaluate(() => window.__saver._settle());
      const p = await fsGet(`experiments/${EXPERIMENT_ID}/participants/${docId}`);
      const pdoc = decodeFields(p.body.fields);
      expect(pdoc.device_supported).toBe(true);
      expect(pdoc.requires_keyboard).toBe(false);
    }
    await context.close();
  });

  test("a desktop browser is not turned away", async ({ page }) => {
    await page.goto(EMULATOR ? "/?emulator=1" : "/");
    await expect(page.getByRole("button", { name: "I agree to participate" })).toBeVisible();
    await expect(page.locator("#device-unsupported")).toHaveCount(0);
  });

  test("a write the database refuses is announced on the page, not only in the console", async ({ page }) => {
    test.skip(!EMULATOR, "needs the Firestore emulator");
    // Regression test for the state a student is in when they skip publishing the rules, or
    // once test-mode rules expire: sign-in succeeds, so the page used to look perfectly
    // healthy from consent to debrief and only admitted the problem on the last screen.
    await page.goto("/?emulator=1");
    await page.waitForFunction(() => window.__saver && window.__saver.docId);
    // Emulator runs carry an informational banner; what must be absent is a failure banner.
    await expect(page.locator('#data-saver-banner[data-kind="offline"]')).toHaveCount(0);

    // Force a genuine permission-denied on a normal save path by aiming the participant
    // document at someone else's id, which the rules refuse exactly as deny-all rules would.
    await page.evaluate(async () => {
      window.__saver.docId = "someone-else-deadbeef";
      await window.__saver.updateParticipant({ blocked: true });
    });

    const banner = page.locator("#data-saver-banner");
    await expect(banner).toBeVisible();
    await expect(banner).toHaveAttribute("data-kind", "offline");
    await expect(banner).toContainText("NOT being saved");
    await expect(banner).toContainText("permission-denied");
    await expect(banner).toContainText("2.3");
    expect(await page.evaluate(() => window.__saver.stats.writes_failed)).toBeGreaterThan(0);
  });

  test("the download fallback tells the participant where to send the file", async ({ page }) => {
    await page.goto(EMULATOR ? "/?emulator=1" : "/");
    await page.waitForFunction(() => window.__saver && window.__saver.docId);
    await page.evaluate(() => window.__saver._offerDownload(null, "[]"));
    const box = page.locator("#data-saver-fallback");
    await expect(box).toBeVisible();
    await expect(box).toContainText("@");                       // a contact address is present
    await expect(box).toContainText("you will be paid");
    await expect(box.getByRole("link")).toHaveAttribute("href", /^mailto:/);
  });

  test("security rules reject reads and writes to other participants", async ({ page }) => {
    test.skip(!EMULATOR, "needs the Firestore emulator");
    await page.goto("/?emulator=1");
    await page.waitForFunction(() => window.__saver && window.__saver.uid);

    const results = await page.evaluate(async () => {
      const s = window.__saver;
      const fb = s.fb;
      const out = {};
      const attempt = async (name, fn) => {
        try { await fn(); out[name] = "allowed"; } catch (e) { out[name] = e.code || e.message; }
      };
      await attempt("read own doc", () =>
        fb.getDoc(fb.doc(s.db, "experiments", s.opts.experiment_id, "participants", s.docId)));
      await attempt("write other participant", () =>
        fb.setDoc(fb.doc(s.db, "experiments", s.opts.experiment_id, "participants", "someone-else"), { hacked: true }));
      await attempt("write other participant trials", () =>
        fb.setDoc(fb.doc(s.db, "experiments", s.opts.experiment_id, "participants", "someone-else", "trials", "c0"), { trials: [] }));
      await attempt("write unrelated collection", () =>
        fb.setDoc(fb.doc(s.db, "spam", "doc"), { spam: true }));
      await attempt("error doc with wrong uid", () =>
        fb.addDoc(fb.collection(s.db, "experiments", s.opts.experiment_id, "errors"), { uid: "not-me", message: "x" }));
      await attempt("own chunk (should be allowed)", () =>
        fb.setDoc(fb.doc(s.db, "experiments", s.opts.experiment_id, "participants", s.docId, "trials", "chunk-test"), { trials: [{ a: 1 }] }));
      await attempt("participant doc without the run suffix", () =>
        fb.setDoc(fb.doc(s.db, "experiments", s.opts.experiment_id, "participants", s.uid), { sneaky: true }));
      await attempt("another browser's run id", () =>
        fb.setDoc(fb.doc(s.db, "experiments", s.opts.experiment_id, "participants", "someone-else-abcd1234"), { sneaky: true }));
      return out;
    });

    expect(results["read own doc"]).toBe("permission-denied");
    expect(results["write other participant"]).toBe("permission-denied");
    expect(results["write other participant trials"]).toBe("permission-denied");
    expect(results["write unrelated collection"]).toBe("permission-denied");
    expect(results["error doc with wrong uid"]).toBe("permission-denied");
    expect(results["own chunk (should be allowed)"]).toBe("allowed");
    expect(results["participant doc without the run suffix"]).toBe("permission-denied");
    expect(results["another browser's run id"]).toBe("permission-denied");
  });

  test("uncaught errors are logged to the errors collection", async ({ page }) => {
    test.skip(!EMULATOR, "needs the Firestore emulator");
    await page.goto("/?emulator=1");
    await page.waitForFunction(() => window.__saver && window.__saver.uid);
    const uid = await page.evaluate(() => window.__saver.uid);

    // Simulate a bug in a trial: an uncaught exception.
    await page.evaluate(() => {
      setTimeout(() => { throw new Error("simulated bug in trial code"); }, 0);
    });
    await page.waitForFunction(() => window.__saver.stats.errors_logged >= 1);
    await page.evaluate(() => new Promise((r) => setTimeout(r, 1500)));

    const errs = await fsGet(`experiments/${EXPERIMENT_ID}/errors?pageSize=100`);
    const mine = (errs.body.documents || []).map((d) => decodeFields(d.fields)).filter((d) => d.uid === uid);
    expect(mine.length).toBe(1);
    expect(mine[0].message).toContain("simulated bug");
    expect(mine[0].context.kind).toBe("uncaught");
  });
});
