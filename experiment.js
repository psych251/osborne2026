/*
 * Psych 251 experiment template: demo experiment.
 *
 * This file is the one you edit. It builds a jsPsych 8 timeline and wires it to DataSaver
 * (src/save.js), which writes to your Firebase project. Everything below is a working
 * example you can replace piece by piece:
 *
 *   1. consent           course-wide consent text (required at the start of every study)
 *   2. instructions
 *   3. demographics      a multi-question survey page (jsPsych "survey" plugin, SurveyJS)
 *   4. framing task      a between-subjects manipulation with random assignment
 *   5. lexical decision  a short keyboard reaction-time block (trial-level data)
 *   6. feedback          Likert + free text
 *   7. debrief           saves data, then shows thanks or redirects to Prolific
 *
 * The example manipulation is the classic "Asian disease" framing problem
 * (Tversky & Kahneman, 1981): people are risk-averse for gains and risk-seeking for losses.
 */

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
window.TEMPLATE_VERSION = "0.1.0";

const EXPERIMENT = {
  // Firestore path: experiments/<id>/participants/... Change it when you start a new study
  // so pilot data and real data never mix (e.g. "smith2016-pilot-a", "smith2016-final").
  id: "osborne2026-pilot-a",

  // Trials per Firestore write. 1 = save every trial the moment it finishes (dropouts leave
  // partial data). The free tier allows 20,000 writes/day: with 200 participants x 100 trials
  // you would exceed it, so raise this for long trial-based tasks (e.g. 20).
  chunk_size: 1,

  // Also store the complete jsPsych dataset on the participant document at the end.
  // Costs one extra write and makes export robust; turn off if trials are very large.
  save_full_data_at_end: true,

  // Prolific: if set, participants are redirected to Prolific when they finish.
  // Leave empty for local testing or non-Prolific samples.
  prolific_completion_code: "",

  // Contact shown in consent and debrief.
  contact_email: "andreaml@stanford.edu",

  // Does this study need a physical keyboard? The demo does (the word task uses F and J).
  // On a phone or tablet no keyboard appears, so a participant cannot answer those trials;
  // they would time out silently and the session would still look complete. When true, such
  // devices are turned away before consent. Set to false if your study is buttons/touch only.
  requires_keyboard: false,
};

// True on anything with a mouse, trackpad, or stylus, including laptops with touchscreens.
// False on phones and tablets without a pointing device, which are also the devices with no
// physical keyboard. See docs/student-guide.md "Devices".
function hasFinePointer() {
  return !!(window.matchMedia && window.matchMedia("(any-pointer: fine)").matches);
}

// `?emulator=1` in the URL sends data to the local emulator instead of the real project.
// Used by `npm test`; handy for development too (start it with `npm run emulators`).
const URL_PARAMS = new URLSearchParams(window.location.search);
const USE_EMULATOR = URL_PARAMS.get("emulator") === "1";
// `?chunk_size=N` overrides the setting above; used by the test suite to exercise chunked writes.
const CHUNK_SIZE = Number(URL_PARAMS.get("chunk_size")) || EXPERIMENT.chunk_size;
// How long each social media post must stay on screen before Continue works (original study: 60 s).
// Test runs (`npm test`, which use the emulator) skip the wait so the robot does not take minutes.
const POST_WAIT_MS = USE_EMULATOR ? 0 : 60000;
// Test-only: `?cc=CODE` sets a Prolific completion code during emulator runs, so the test
// suite can check the screen a participant sees once you have set yours. Ignored in live runs.
if (USE_EMULATOR && URL_PARAMS.get("cc")) EXPERIMENT.prolific_completion_code = URL_PARAMS.get("cc");

// ---------------------------------------------------------------------------
// Boot: connect the saver first so even a crash in the first trial gets logged.
// ---------------------------------------------------------------------------
(async function main() {
  const deviceSupported = !EXPERIMENT.requires_keyboard || hasFinePointer();

  const saver = await DataSaver.init({
    experiment_id: EXPERIMENT.id,
    chunk_size: CHUNK_SIZE,
    save_full_data_at_end: EXPERIMENT.save_full_data_at_end,
    use_emulator: USE_EMULATOR,
    contact_email: EXPERIMENT.contact_email,
  });
  window.__saver = saver; // for debugging and the automated test

  // Record the device verdict on the participant document before anything else, so a
  // participant turned away below is still visible in the data rather than simply absent.
  saver.updateParticipant({ device_supported: deviceSupported, requires_keyboard: EXPERIMENT.requires_keyboard });

  if (!deviceSupported) {
    document.body.innerHTML =
      '<div id="device-unsupported" class="jspsych-content" style="max-width:640px;margin:15vh auto;font:16px/1.6 system-ui,sans-serif;">' +
      "<h2>Please use a computer</h2>" +
      "<p>This study needs a computer with a physical keyboard, because part of it is answered " +
      "by pressing keys. Phones and tablets cannot be used.</p>" +
      "<p>Please reopen this link on a laptop or desktop computer. If you were sent here from " +
      "Prolific, you can return the study and take it later on a computer; nothing has been recorded " +
      "against you.</p>" +
      "<p>Questions: <a href=\"mailto:" + EXPERIMENT.contact_email + "\">" + EXPERIMENT.contact_email + "</a></p></div>";
    return;
  }

  const jsPsych = initJsPsych({
    show_progress_bar: true,
    auto_update_progress_bar: true,
    on_data_update: (trial) => saver.onTrial(trial),
    on_finish: async () => {
      const el = jsPsych.getDisplayElement();
      el.innerHTML = '<div id="finish-message"><p class="thanks">Saving your responses…</p></div>';
      // finish() flushes remaining trials, marks the participant complete, and (only if
      // saving failed) appends a download-fallback box to the display element.
      const result = await saver.finish(jsPsych);
      const consentRow = jsPsych.data.get().filter({ task: "consent" }).values()[0];
      const consented = !consentRow || consentRow.consented !== false;
      const msg = document.getElementById("finish-message");

      if (!consented) {
        msg.innerHTML = "<h2 class='thanks'>Thank you</h2><p class='thanks'>You chose not to participate. " +
          "You may close this window" + (EXPERIMENT.prolific_completion_code ? " and return the study on Prolific" : "") + ".</p>";
        return;
      }
      if (result.ok && EXPERIMENT.prolific_completion_code && !USE_EMULATOR) {
        msg.innerHTML = "<p class='thanks'>Saved. Returning you to Prolific…</p>";
        window.location.href =
          "https://app.prolific.com/submissions/complete?cc=" + EXPERIMENT.prolific_completion_code;
        return;
      }
      // In emulator/test runs we stay on the page instead of navigating to Prolific, so that
      // setting a completion code can never turn `npm test` or CI red. Live runs redirect above.
      msg.innerHTML =
        "<h2 class='thanks'>All done</h2>" +
        (result.ok ? "<p class='thanks'>Your responses were saved. Thank you for participating!</p>" : "") +
        (EXPERIMENT.prolific_completion_code
          ? "<p class='thanks'>Your completion code is <strong>" + EXPERIMENT.prolific_completion_code + "</strong>.</p>"
          : "");
    },
  });

  // Record the participant id and URL parameters on every trial row.
  jsPsych.data.addProperties({
    // Must be the run-scoped document id, so trial rows join to participants.csv on export.
    participant_id: saver.docId,
    prolific_pid: saver.params.PROLIFIC_PID || null,
    experiment_id: EXPERIMENT.id,
  });

  // Random assignment to a between-subjects condition, recorded on every trial and on the
  // participant document. (For exact counterbalancing you would need a server; random
  // assignment is fine at course sample sizes.)
  const condition = jsPsych.randomization.sampleWithoutReplacement(["normal", "distress", "transformative"], 1)[0];
  jsPsych.data.addProperties({ condition: condition });
  saver.updateParticipant({ condition: condition });

  // -------------------------------------------------------------------------
  // 1. Consent (course-wide IRB text; edit only the contact address)
  // -------------------------------------------------------------------------
  const consent = {
    type: jsPsychHtmlButtonResponse,
    stimulus: `
      <div class="consent">
        <h2>Consent</h2>
        <p>By answering the following questions, you are participating in a study being performed by
        cognitive scientists in the Stanford Department of Psychology. If you have questions about
        this research, please contact us at <a href="mailto:${EXPERIMENT.contact_email}">${EXPERIMENT.contact_email}</a>.
        You must be at least 18 years old to participate. Your participation in this research is
        voluntary. You may decline to answer any or all of the following questions. You may decline
        further participation, at any time, without adverse consequences. Your anonymity is assured;
        the researchers who have requested your participation will not receive any personal
        information about you.</p>
      </div>`,
    choices: ["I agree to participate", "I do not agree"],
    data: { task: "consent" },
    on_finish: (data) => {
      data.consented = data.response === 0;
      if (!data.consented) {
        // No end message here: jsPsych would paint it over the screen that on_finish renders.
        jsPsych.abortExperiment();
      }
    },
  };

  // -------------------------------------------------------------------------
  // 2. Instructions
  // -------------------------------------------------------------------------
  const instructions = {
    type: jsPsychInstructions,
    pages: [
      `<h2>Welcome!</h2>
       <p>Dear participant, thank you very much for taking part in this study!</p>
       <p>The aim of this study is to understand how people respond to social media content about health. We appreciate your time and help with this study.</p>
       <p>The study will take about 10 minutes.</p>
       <p>Click Next to read the instructions.</p>`,
      `<h2>Instructions</h2>
       <p>Dear participant,</p>
       <p>Thank you very much for participating in this study</p>
       <p>First, you will answer a few questions about yourself.</p>
       <p>Then you will see four social media posts about menopause posted on World Menopause Day last year. All four posts will appear together on one page. Please read all of them carefully. The Continue button will unlock after 60 seconds.</p>
       <p>After the posts, you will answer some more questions. There are no right or wrong answers. Please answer based on your own reaction.</p>`,
    ],
    show_clickable_nav: true,
    data: { task: "instructions" },
  };

  // -------------------------------------------------------------------------
  // 3. Screening question and demographics (survey plugin: one page, several question types)
  // -------------------------------------------------------------------------
  // Question wording and answer options follow the original Qualtrics survey (sent by the authors).
  // As in the original survey, these questions are required (isRequired / required: true). Only the two
  // extra pages from the course template at the end (clarity rating and comments) stay optional.
  // `visibleIf` shows a question only when the condition about an earlier answer is true.
  const agree5 = ["Strongly disagree", "Somewhat disagree", "Neither agree nor disagree", "Somewhat agree", "Strongly agree"];
  const demographics = {
    type: jsPsychSurvey,
    survey_json: {
      showQuestionNumbers: "off",
      completeText: "Continue",
      pages: [
        {
          elements: [
            {
              type: "radiogroup", isRequired: true, name: "menopause_stage",
              title: "Which of the following stages do you think best describes you?",
              choices: [
                { value: "peri", text: "Perimenopause - experiencing symptoms such as hot flushes, brain fog, joint pain, changes in periods" },
                { value: "post", text: "Post menopause - not had a period for 1 year or more" },
                { value: "not", text: "Not going through the menopause" },
              ],
            },
            { type: "text", isRequired: true, name: "age", title: "What is your age? Please enter your age in number of years.", inputType: "number", min: 18, max: 120 },
            {
              type: "text", isRequired: true, name: "education_years", inputType: "number", min: 0, max: 30,
              title: "How many years of formal education have you received after turning 16? This may include attending sixth-form college, institutes of further and higher education both in the UK and abroad, and pursuing professional qualifications. Please provide the number of years as a digit.",
            },
            {
              type: "radiogroup", isRequired: true, name: "knowledge", title: "How knowledgeable do you feel you are about menopause?",
              choices: ["Not knowledgeable at all", "Slightly knowledgeable", "Moderately knowledgeable", "Very knowledgeable", "Extremely knowledgeable"],
            },
            {
              type: "radiogroup", isRequired: true, name: "hrt", title: "Do you have any history of Hormone Replacement Therapy (HRT) to treat any symptoms of menopause?",
              choices: ["Yes, I am currently taking HRT", "Yes, I have previously taken HRT, but I am not currently", "No, I have never nor am I currently taking HRT"],
            },
            {
              type: "radiogroup", isRequired: true, name: "feeling_peri", visibleIf: "{menopause_stage} = 'peri'",
              title: "How do you feel about perimenopause / menopause?",
              choices: ["Looking forward to it", "Accepting of it", "Neutral - no strong view either way", "Dreading it", "Not sure"],
            },
            {
              type: "radiogroup", isRequired: true, name: "feeling_post", visibleIf: "{menopause_stage} = 'post'",
              title: "Now you have been through the menopause, how do you feel about it?",
              choices: ["It was very difficult", "It was difficult", "Neutral - no strong views either way", "It was fine", "Not sure"],
            },
            {
              type: "radiogroup", isRequired: true, name: "social_media_use",
              title: "How much time do you spend on social media platforms (e.g., Facebook, Instagram, Twitter (X))?",
              choices: ["Never", "Less than weekly", "Weekly", "Daily", "Several times per day"],
            },
          ],
        },
      ],
    },
    data: { task: "demographics" },
  };

  // -------------------------------------------------------------------------
  // 4. Social media posts (between-subjects: normal vs distress vs transformative)
  // -------------------------------------------------------------------------
  // The 12 original posts (4 per condition) are screenshots supplied by the authors; they are
  // in the images/ folder as normal_1.jpg ... transformative_4.jpg. In the authors' survey the
  // 4 posts of a condition appear together on one page, so they appear together here too.
  // The Continue button stays disabled for POST_WAIT_MS (60 seconds), as in the original study.
  const postImages = [1, 2, 3, 4].map((n) => `images/${condition}_${n}.jpg`);
  const postsPage = {
    type: jsPsychHtmlButtonResponse,
    stimulus:
      `<div class="post"><p>Please read the following social media posts that were posted on World Menopause Day last year.</p>` +
      postImages.map((src) => `<p><img src="${src}" alt="A social media post about menopause" style="max-width:100%;height:auto;border:1px solid #ddd;"></p>`).join("") +
      `</div>`,
    choices: ["Continue"],
    enable_button_after: POST_WAIT_MS,
    data: { task: "posts", post_images: postImages.join(",") },
  };

  // -------------------------------------------------------------------------
  // 5. Ratings (wording and scale labels follow the authors' Qualtrics survey)
  // -------------------------------------------------------------------------
  // jsPsych's Likert plugin stores answers as 0 to 4 (add 1 in the analysis to get 1 to 5).
  const feel5 = ["Definitely don't feel", "Probably don't feel", "Neither true nor false", "Probably feel", "Definitely feel"];
  const likely5 = ["Extremely unlikely", "Somewhat unlikely", "Neither likely nor unlikely", "Somewhat likely", "Extremely likely"];
  // Turns a list of [name, prompt] pairs into the question objects the Likert plugin wants.
  const likertQuestions = (items, labels) =>
    items.map(([name, prompt]) => ({ prompt: prompt, name: name, labels: labels, required: true }));

  const ratingsAgree = {
    type: jsPsychSurveyLikert,
    preamble: "<p>After reading the social media posts about menopause, to what extent do you agree with the following statements:</p>",
    questions: likertQuestions([
      ["liked", "I liked the posts"],
      ["credible", "I found the posts credible"],
      ["trust", "I trust the post"],
      ["empowered", "I feel empowered about menopause"],
      ["knowledgeable", "I feel more knowledgeable about menopause"],
    ], agree5),
    data: { task: "ratings_agree" },
  };
  const ratingsFeel = {
    type: jsPsychSurveyLikert,
    preamble: "<p>After reading the menopause posts, to what extent do you feel the following?</p>",
    questions: likertQuestions([
      ["worried", "Worried"],
      ["reassured", "Reassured"],
      ["confused", "Confused"],
      ["in_control", "In control"],
      ["optimistic", "Optimistic"],
      ["anxious", "Anxious"],
    ], feel5),
    data: { task: "ratings_feel" },
  };
  const ratingsAction = {
    type: jsPsychSurveyLikert,
    preamble: "<p>After reading the menopause posts, how likely would you be to take the following action?</p>",
    questions: likertQuestions([
      ["like", "'Like' the post"],
      ["share", "Share the post"],
      ["save", "Save / bookmark / screenshot the post"],
      ["comment", "Comment on the post"],
      ["search_similar", "Search for other similar posts and messages"],
    ], likely5),
    data: { task: "ratings_action" },
  };
  const ratingsDiscuss = {
    type: jsPsychSurveyLikert,
    preamble: "<p>How likely would you be to discuss the social media posts with the following?</p>",
    questions: likertQuestions([
      ["discuss_friends_family", "Friends and family"],
      ["discuss_health_professional", "A health professional"],
    ], likely5),
    data: { task: "ratings_discuss" },
  };
  // Last questions about the posts (one page of pick-one questions).
  const messaging = {
    type: jsPsychSurvey,
    survey_json: {
      showQuestionNumbers: "off",
      completeText: "Continue",
      pages: [
        {
          elements: [
            { type: "radiogroup", isRequired: true, name: "message_type", title: "After reading the social media posts, what kind of messaging do they convey about menopause?", choices: ["Positive", "Neutral", "Negative"] },
            { type: "radiogroup", isRequired: true, name: "fit_own_views", title: "To what extent does this fit with your own views, attitudes, or experience of menopause?", choices: agree5 },
            { type: "radiogroup", isRequired: true, name: "rep_social_media", title: "To what extent do you think the posts are representative of posts about menopause on social media?", choices: agree5 },
            { type: "radiogroup", isRequired: true, name: "rep_media", title: "To what extent do you think the posts are representative of posts about menopause in the media (newspaper, television)?", choices: agree5 },
            { type: "radiogroup", isRequired: true, name: "rep_health_professionals", title: "To what extent do you think the posts are representative of health professionals' views?", choices: agree5 },
          ],
        },
      ],
    },
    data: { task: "messaging" },
  };

  // -------------------------------------------------------------------------
  // 6. Feedback
  // -------------------------------------------------------------------------
  const feedback = {
    type: jsPsychSurveyLikert,
    questions: [
      {
        prompt: "How clear were the instructions?", name: "instructions_clear", required: false,
        labels: ["Very unclear", "Unclear", "Neutral", "Clear", "Very clear"],
      },
    ],
    data: { task: "feedback_likert" },
  };
  const comments = {
    type: jsPsychSurveyText,
    questions: [{ prompt: "Any comments about the study? (optional)", name: "comments", rows: 4 }],
    data: { task: "feedback_text" },
  };

  // -------------------------------------------------------------------------
  // 7. Debrief
  // -------------------------------------------------------------------------
  const debrief = {
    type: jsPsychHtmlButtonResponse,
    stimulus: `
      <h2>Debrief</h2>
      <p>Thank you very much for participating in this study!</p>
      <p>Many people learn about menopause from social media. We are replicating a published study to understand how the way menopause is portrayed affects how people feel, what they would do, and how they engage with the posts.</p>
      <p>There were three versions of the posts: everyday experiences, distressing experiences, and experiences of positive change. Every participant is randomly shown only one version. We did not explain this earlier because knowing this could affect your answers.</p>
      <p>Your responses are anonymous.</p>
      <p>If you have questions, please contact <a href="mailto:${EXPERIMENT.contact_email}">${EXPERIMENT.contact_email}</a>. Some posts could be upsetting or confusing. If you feel worried or if you have any questions about the menopause transition, you can talk to a doctor or another health professional.</p>
      <p>Press the button to save your responses and finish.</p>`,
    choices: ["Finish"],
    data: { task: "debrief" },
  };

  await jsPsych.run([
    consent,
    instructions,
    demographics,
    postsPage,
    ratingsAgree,
    ratingsFeel,
    ratingsAction,
    ratingsDiscuss,
    messaging,
    feedback,
    comments,
    debrief,
  ]);
})();
