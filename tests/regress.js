const path = require("path");
const fs = require("fs");
const http = require("http");
const { spawnSync } = require("child_process");
const P = process.env.PROJECT_DIR || path.join(__dirname, "..");
const URI =
  process.env.TEST_MONGODB_URI || "mongodb://127.0.0.1:27099/cm_regress";
Object.assign(process.env, {
  MONGODB_URI: URI,
  JWT_SECRET: "test-secret",
  ADMIN_REGISTRATION_KEY: "letmein",
  NODE_ENV: "test",
  EMAIL_USER: "x@x.com",
  EMAIL_PASSWORD: "pw",
});
const req = (p) => require(path.join(P, p));
const mongoose = req("node_modules/mongoose");
const bcrypt = req("node_modules/bcrypt");
const jwt = req("node_modules/jsonwebtoken");
// capture outgoing e-mail instead of sending
const nodemailer = req("node_modules/nodemailer");
const sent = [];
nodemailer.createTransport = () => ({
  sendMail: async (m) => {
    sent.push(m);
    return { messageId: "fake" };
  },
});

const app = req("app");
const User = req("src/models/User"),
  Course = req("src/models/Course"),
  Enrollment = req("src/models/Enrollment");
const QuizSubmission = req("src/models/QuizSubmission"),
  AssignmentSubmission = req("src/models/AssignmentSubmission");

let base;
const api = async (method, url, { token, body, headers } = {}) => {
  const r = await fetch(base + url, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await r.json();
  } catch {}
  return { status: r.status, body: json, headers: r.headers };
};
const tok = (u) => jwt.sign({ id: String(u._id), role: u.role }, "test-secret");
const tests = [];
const t = (id, title, fn) => tests.push({ id, title, fn });
const eq = (a, b, m) => {
  if (a !== b)
    throw new Error(
      `${m || "value"}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`,
    );
};
const ok = (c, m) => {
  if (!c) throw new Error(m);
};
const F = {};

async function setup() {
  await mongoose.connect(URI);
  await mongoose.connection.dropDatabase();
  const hs = await bcrypt.hash("student123", 10),
    ha = await bcrypt.hash("admin123", 10);
  F.admin = await User.create({
    name: "Admin",
    email: "admin@t.com",
    passwordHash: ha,
    role: "admin",
  });
  F.A = await User.create({
    name: "Alice",
    email: "alice@t.com",
    passwordHash: hs,
  });
  F.B = await User.create({
    name: "Bob",
    email: "bob@t.com",
    passwordHash: hs,
  });
  F.C = await User.create({
    name: "Carol",
    email: "carol@t.com",
    passwordHash: hs,
  });
  F.D = await User.create({
    name: "Dave",
    email: "dave@t.com",
    passwordHash: hs,
  });
  F.E = await User.create({
    name: "Erin",
    email: "erin@t.com",
    passwordHash: hs,
  });
  F.c1 = await Course.create({
    title: "C1",
    description: "d",
    instructorName: "I",
    price: 100,
    batches: [{ name: "b1", startDate: new Date() }],
    syllabus: [
      {
        title: "M1",
        lessons: [
          {
            title: "L1",
            videoUrl: "v",
            quiz: [
              { question: "q1", options: ["a", "b"], correctIndex: 1 },
              { question: "q2", options: ["a", "b", "c"], correctIndex: 2 },
            ],
          },
          { title: "L2", videoUrl: "v", assignmentPrompt: "do it" },
        ],
      },
    ],
  });
  F.c2 = await Course.create({
    title: "C2",
    description: "d",
    instructorName: "I",
    price: 50,
    syllabus: [
      {
        title: "M",
        lessons: [{ title: "L3", videoUrl: "v", assignmentPrompt: "x" }],
      },
    ],
  });
  F.L1 = F.c1.syllabus[0].lessons[0]._id;
  F.L2 = F.c1.syllabus[0].lessons[1]._id;
  F.L3 = F.c2.syllabus[0].lessons[0]._id;
  F.eA = await Enrollment.create({ student: F.A._id, course: F.c1._id });
  F.eB = await Enrollment.create({ student: F.B._id, course: F.c1._id });
  F.eE = await Enrollment.create({ student: F.E._id, course: F.c1._id });
  await Enrollment.create({ student: F.E._id, course: F.c2._id });
  F.s1 = await AssignmentSubmission.create({
    student: F.A._id,
    course: F.c1._id,
    lessonId: F.L2,
    answerType: "link",
    answer: "http://x",
  });
  F.s2 = await AssignmentSubmission.create({
    student: F.A._id,
    course: F.c2._id,
    lessonId: F.L3,
    answerType: "text",
    answer: "hello",
  });
  await QuizSubmission.create({
    student: F.E._id,
    course: F.c1._id,
    lessonId: F.L1,
    answers: [1, 2],
    score: 2,
    total: 2,
    percent: 100,
  });
  await AssignmentSubmission.create({
    student: F.E._id,
    course: F.c1._id,
    lessonId: F.L2,
    answerType: "text",
    answer: "e",
  });
  F.aT = tok(F.admin);
}

t("BUG-013", "Quiz percent is score/total*100", async () => {
  const r = await api("POST", "/api/quizzes/submit", {
    token: tok(F.A),
    body: {
      courseId: String(F.c1._id),
      lessonId: String(F.L1),
      answers: [1, 0],
    },
  });
  eq(r.status, 200, "status");
  eq(r.body.score, 1, "score");
  eq(r.body.percent, 50, "percent");
});
t("BUG-012a", "Login works with the real password", async () => {
  const r = await api("POST", "/api/auth/login", {
    body: { email: "alice@t.com", password: "student123" },
  });
  eq(r.status, 200, "status");
  ok(r.body.token, "token missing");
});
t(
  "BUG-012b",
  "Login rejects wrong password and the raw stored hash",
  async () => {
    const w = await api("POST", "/api/auth/login", {
      body: { email: "alice@t.com", password: "wrong-pass" },
    });
    eq(w.status, 400, "wrong pw status");
    const u = await User.findById(F.A._id);
    const h = await api("POST", "/api/auth/login", {
      body: { email: "alice@t.com", password: u.passwordHash },
    });
    eq(h.status, 400, "hash-as-password status");
  },
);
t("BUG-014", "First enrollment succeeds, duplicate is rejected", async () => {
  const r1 = await api("POST", `/api/enrollments/${F.c2._id}`, {
    token: tok(F.C),
    body: {},
  });
  eq(r1.status, 201, "first enroll");
  const r2 = await api("POST", `/api/enrollments/${F.c2._id}`, {
    token: tok(F.C),
    body: {},
  });
  eq(r2.status, 400, "duplicate enroll");
});
t("BUG-015", "Admin assignments honours ?courseId filter", async () => {
  const r = await api("GET", `/api/admin/assignments?courseId=${F.c2._id}`, {
    token: F.aT,
  });
  eq(r.status, 200, "status");
  eq(r.body.length, 1, "count");
  eq(String(r.body[0].course._id), String(F.c2._id), "course");
});
t(
  "BUG-016a",
  "complete-lesson persists progress before responding",
  async () => {
    const r = await api(
      "PATCH",
      `/api/enrollments/${F.eB._id}/complete-lesson`,
      { token: tok(F.B), body: { lessonId: String(F.L1) } },
    );
    eq(r.status, 200, "status");
    const doc = await Enrollment.findById(F.eB._id).lean();
    eq(doc.progress.completedLessons.length, 1, "persisted lessons");
    eq(doc.progress.percent, 50, "persisted percent");
  },
);
t("BUG-016b", "A failing save must not crash the server process", async () => {
  const r = spawnSync("node", [path.join(__dirname, "probe_crash.js")], {
    env: {
      ...process.env,
      PROJECT_DIR: P,
      ENROLL_ID: String(F.eA._id),
      TOKEN: tok(F.A),
    },
    encoding: "utf8",
    timeout: 20000,
  });
  ok(
    /ALIVE/.test(r.stdout),
    `server process died (exit ${r.status}): ${(r.stderr || "").split("\n").filter(Boolean).slice(0, 2).join(" | ")}`,
  );
});
t(
  "BUG-016c",
  "A failed save is reported to the client, not swallowed",
  async () => {
    const r = spawnSync("node", [path.join(__dirname, "probe_crash.js")], {
      env: {
        ...process.env,
        PROJECT_DIR: P,
        MODE: "save-fails",
        ENROLL_ID: String(F.eA._id),
        TOKEN: tok(F.A),
        LESSON_ID: String(F.L1),
      },
      encoding: "utf8",
      timeout: 20000,
    });
    const st = /STATUS (\d+)/.exec(r.stdout || "");
    const alive = /ALIVE/.test(r.stdout || "");
    ok(
      st && +st[1] >= 400 && alive,
      `client got status ${st && st[1]} (200 = told "success" although nothing was saved); server alive: ${alive} (exit ${r.status})`,
    );
  },
);
t(
  "BUG-017",
  "CORS advertises PUT/PATCH/DELETE (preflight and normal responses)",
  async () => {
    const p = await api("OPTIONS", "/api/admin/courses/abc", {
      headers: {
        Origin: "http://localhost:5173",
        "Access-Control-Request-Method": "PATCH",
      },
    });
    ok(
      /PATCH/.test(p.headers.get("access-control-allow-methods") || ""),
      `preflight allow-methods = ${p.headers.get("access-control-allow-methods")}`,
    );
    const g = await api("GET", "/", {
      headers: { Origin: "http://localhost:5173" },
    });
    const h = g.headers.get("access-control-allow-methods");
    ok(h === null || /PATCH/.test(h), `normal response allow-methods = ${h}`);
  },
);
t(
  "BUG-018a",
  "Admin self-registration needs the correct adminKey",
  async () => {
    const good = await api("POST", "/api/auth/register", {
      body: {
        name: "Root",
        email: "root@t.com",
        password: "secret1",
        adminKey: "letmein",
      },
    });
    eq(
      good.body && good.body.user && good.body.user.role,
      "admin",
      "role with valid key",
    );
    const bad = await api("POST", "/api/auth/register", {
      body: {
        name: "Evil",
        email: "evil@t.com",
        password: "secret1",
        adminKey: "wrong",
      },
    });
    ok(
      bad.status === 400 || bad.status === 403,
      `wrong key status ${bad.status}`,
    );
    const plain = await api("POST", "/api/auth/register", {
      body: { name: "Norm", email: "norm@t.com", password: "secret1" },
    });
    eq(plain.body.user.role, "student", "default role");
    const sneaky = await api("POST", "/api/auth/register", {
      body: {
        name: "Sneak",
        email: "sneak@t.com",
        password: "secret1",
        role: "admin",
      },
    });
    ok(
      sneaky.status >= 400 || sneaky.body.user.role === "student",
      "role:admin without key was accepted",
    );
  },
);
t(
  "BUG-018b",
  "Service layer never trusts a role without a valid adminKey",
  async () => {
    const svc = req("src/services/auth.service");
    let role;
    try {
      role = (
        await svc.register({
          name: "Svc",
          email: "svc@t.com",
          password: "secret1",
          role: "admin",
        })
      ).user.role;
    } catch {
      role = "rejected";
    }
    ok(role !== "admin", "service created an admin from a bare role field");
  },
);
t("BUG-019", "Invalid / missing JWT is answered with 401", async () => {
  eq(
    (await api("GET", "/api/auth/me", { token: "garbage.token.here" })).status,
    401,
    "me + bad token",
  );
  eq(
    (await api("GET", "/api/enrollments/my", { token: "garbage.token.here" }))
      .status,
    401,
    "enrollments + bad token",
  );
  eq((await api("GET", "/api/enrollments/my")).status, 401, "no header");
});
t("BUG-020", "Validation failures return the list of issues", async () => {
  const r = await api("POST", "/api/auth/register", {
    body: { name: "x", email: "nope", password: "1" },
  });
  eq(r.status, 400, "status");
  ok(
    Array.isArray(r.body.errors) && r.body.errors.length >= 3,
    `errors field = ${JSON.stringify(r.body.errors)}`,
  );
});
t(
  "BUG-021",
  "Banned / deleted users cannot log in or reuse tokens",
  async () => {
    await User.findByIdAndUpdate(F.D._id, { isBanned: true });
    const l = await api("POST", "/api/auth/login", {
      body: { email: "dave@t.com", password: "student123" },
    });
    eq(l.status, 403, "banned login");
    const m = await api("GET", "/api/auth/me", { token: tok(F.D) });
    ok(m.status === 401 || m.status === 403, `banned token status ${m.status}`);
    const ghost = jwt.sign(
      { id: String(new mongoose.Types.ObjectId()), role: "student" },
      "test-secret",
    );
    eq(
      (await api("GET", "/api/auth/me", { token: ghost })).status,
      401,
      "token of non-existent user",
    );
  },
);
t(
  "BUG-022",
  "complete-lesson checks ownership and lesson membership",
  async () => {
    const idor = await api(
      "PATCH",
      `/api/enrollments/${F.eA._id}/complete-lesson`,
      { token: tok(F.B), body: { lessonId: String(F.L1) } },
    );
    ok(
      idor.status === 403 || idor.status === 404,
      `other student's enrollment status ${idor.status}`,
    );
    const foreign = await api(
      "PATCH",
      `/api/enrollments/${F.eB._id}/complete-lesson`,
      { token: tok(F.B), body: { lessonId: String(F.L3) } },
    );
    eq(foreign.status, 400, "lesson from another course");
    const after = await Enrollment.findById(F.eB._id).lean();
    ok(after.progress.percent <= 100, `percent ${after.progress.percent}`);
    ok(
      !after.progress.completedLessons.map(String).includes(String(F.L3)),
      "foreign lesson stored",
    );
  },
);
t("BUG-023", "Enrollment batchId must belong to the course", async () => {
  const bad = await api("POST", `/api/enrollments/${F.c1._id}`, {
    token: tok(F.C),
    body: { batchId: String(new mongoose.Types.ObjectId()) },
  });
  eq(bad.status, 400, "unknown batch");
  const good = await api("POST", `/api/enrollments/${F.c1._id}`, {
    token: tok((F.D2 = F.D2 || F.C)),
    body: { batchId: String(F.c1.batches[0]._id) },
  });
  eq(good.status, 201, "valid batch");
});
t("BUG-024a", "Quiz submit validates answers payload", async () => {
  const r = await api("POST", "/api/quizzes/submit", {
    token: tok(F.A),
    body: { courseId: String(F.c1._id), lessonId: String(F.L1) },
  });
  eq(r.status, 400, "status");
  ok(/answers/i.test(r.body.message), `message: ${r.body.message}`);
});
t(
  "BUG-024b",
  "Assignment submit validates lesson membership and fields",
  async () => {
    const bad = await api("POST", "/api/assignments/submit", {
      token: tok(F.A),
      body: {
        courseId: String(F.c1._id),
        lessonId: String(new mongoose.Types.ObjectId()),
        answerType: "text",
        answer: "hi",
      },
    });
    eq(bad.status, 400, "unknown lesson");
    const l3 = await api("POST", "/api/assignments/submit", {
      token: tok(F.A),
      body: {
        courseId: String(F.c1._id),
        lessonId: String(F.L3),
        answerType: "text",
        answer: "hi",
      },
    });
    eq(l3.status, 400, "lesson of another course");
  },
);
t(
  "BUG-025",
  "Course search treats user input as text, not a regex",
  async () => {
    const r = await api("GET", "/api/courses?search=(");
    eq(r.status, 200, "status");
    eq(r.body.total, 0, "total");
    const dot = await api("GET", "/api/courses?search=.*");
    eq(dot.body.total, 0, "'.*' must not match everything");
  },
);
t(
  "BUG-026",
  "Analytics chart buckets enrolments by the right day (TZ-safe)",
  async () => {
    await Enrollment.create({ student: F.D._id, course: F.c2._id });
    const r = await api("GET", "/api/admin/analytics", { token: F.aT });
    const todayUTC = new Date().toISOString().slice(0, 10);
    const last = r.body.chartData[29];
    eq(r.body.chartData.length, 30, "points");
    eq(last.date, todayUTC, "last bucket date");
    ok(
      last.enrollments >= 1,
      `today's enrolments missing from chart (${JSON.stringify(last)})`,
    );
    const mn = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ];
    const d = new Date(last.date + "T00:00:00Z");
    eq(
      last.displayDate,
      `${mn[d.getUTCMonth()]} ${d.getUTCDate()}`,
      "label matches date",
    );
  },
);
t("BUG-027", "Welcome e-mail escapes the user's name", async () => {
  sent.length = 0;
  await api("POST", "/api/auth/register", {
    body: {
      name: "<img src=x onerror=alert(1)>",
      email: "xss@t.com",
      password: "secret1",
    },
  });
  await new Promise((r) => setTimeout(r, 300));
  ok(sent.length === 1, "no e-mail captured");
  ok(
    !sent[0].html.includes("<img src=x"),
    "raw HTML from name present in e-mail body",
  );
});
t("BUG-028", "Admin updates are validated", async () => {
  const g = await api("PATCH", `/api/admin/assignments/${F.s1._id}/review`, {
    token: F.aT,
    body: { grade: 500 },
  });
  eq(g.status, 400, "grade 500");
  const s = await api("PATCH", `/api/admin/assignments/${F.s1._id}/review`, {
    token: F.aT,
    body: { status: "bogus" },
  });
  eq(s.status, 400, "status bogus");
  const okr = await api("PATCH", `/api/admin/assignments/${F.s1._id}/review`, {
    token: F.aT,
    body: { grade: 90, status: "reviewed", reviewNotes: "ok" },
  });
  eq(okr.status, 200, "valid review");
  const p = await api("PATCH", `/api/admin/courses/${F.c2._id}`, {
    token: F.aT,
    body: { price: "abc" },
  });
  eq(p.status, 400, "price abc");
  const n = await api("PATCH", `/api/admin/courses/${F.c2._id}`, {
    token: F.aT,
    body: { price: -5 },
  });
  eq(n.status, 400, "negative price");
  const nf = await api(
    "PATCH",
    `/api/admin/courses/${new mongoose.Types.ObjectId()}`,
    { token: F.aT, body: { price: 5 } },
  );
  eq(nf.status, 404, "missing course");
});
t("BUG-029a", "Deleting a user removes their learning data", async () => {
  const r = await api("DELETE", `/api/users/${F.E._id}`, { token: F.aT });
  eq(r.status, 200, "status");
  const left =
    (await Enrollment.countDocuments({ student: F.E._id })) +
    (await QuizSubmission.countDocuments({ student: F.E._id })) +
    (await AssignmentSubmission.countDocuments({ student: F.E._id }));
  eq(left, 0, "orphan documents left");
});
t(
  "BUG-029b",
  "Deleting a course removes enrolments and submissions",
  async () => {
    const r = await api("DELETE", `/api/admin/courses/${F.c1._id}`, {
      token: F.aT,
    });
    eq(r.status, 200, "status");
    const left =
      (await Enrollment.countDocuments({ course: F.c1._id })) +
      (await QuizSubmission.countDocuments({ course: F.c1._id })) +
      (await AssignmentSubmission.countDocuments({ course: F.c1._id }));
    eq(left, 0, "orphan documents left");
  },
);
t(
  "BUG-031",
  "Malformed course id gives a clean 404 (no Mongoose internals)",
  async () => {
    const r = await api("GET", "/api/courses/not-an-id");
    eq(r.status, 404, "status");
    ok(
      !/cast|objectid/i.test(r.body.message),
      `message leaks internals: ${r.body.message}`,
    );
  },
);
t("BUG-030", "seed.js refuses to wipe a production database", async () => {
  const seedUri = "mongodb://127.0.0.1:27099/cm_seedcheck";
  const c = await mongoose.createConnection(seedUri).asPromise();
  await c.dropDatabase();
  const r = spawnSync("node", [path.join(P, "seed.js")], {
    cwd: P,
    env: { ...process.env, NODE_ENV: "production", MONGODB_URI: seedUri },
    encoding: "utf8",
    timeout: 60000,
  });
  const n = await c.collection("users").countDocuments();
  await c.dropDatabase();
  await c.close();
  ok(
    n === 0 && r.status !== 0,
    `seed ran in production (exit ${r.status}, users inserted: ${n})`,
  );
});
t("BUG-032", "Health check answers even when MongoDB is down", async () => {
  const script = `const http=require('http');const app=require(${JSON.stringify(path.join(P, "app"))});http.createServer(app).listen(0,async function(){const s=Date.now();try{const r=await fetch('http://127.0.0.1:'+this.address().port+'/');console.log('RES',r.status,Date.now()-s)}catch(e){console.log('ERR',e.message)}process.exit(0)});`;
  const r = spawnSync("node", ["-e", script], {
    env: { ...process.env, MONGODB_URI: "mongodb://127.0.0.1:27098/none" },
    encoding: "utf8",
    timeout: 30000,
  });
  const m = /RES (\d+) (\d+)/.exec(r.stdout || "");
  ok(
    m && m[1] === "200" && +m[2] < 3000,
    `health check result: ${(r.stdout || "").trim().split("\n").pop()}`,
  );
});
t("BUG-033a", "package.json is consistent", async () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(P, "package.json"), "utf8"));
  ok(
    fs.existsSync(path.join(P, pkg.main)),
    `main "${pkg.main}" does not exist`,
  );
  ok(
    !pkg.dependencies.recharts,
    "front-end only package 'recharts' is a backend dependency",
  );
});
t("BUG-033b", "Server refuses to start without JWT_SECRET", async () => {
  const env = { ...process.env, PORT: "5077" };
  delete env.JWT_SECRET;
  const r = spawnSync("node", [path.join(P, "server.js")], {
    cwd: P,
    env,
    encoding: "utf8",
    timeout: 6000,
  });
  ok(
    r.status !== null && r.status !== 0,
    "server started without JWT_SECRET (kept running until killed)",
  );
});

(async () => {
  await setup();
  const server = http.createServer(app).listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;
  let pass = 0,
    fail = 0;
  for (const x of tests) {
    try {
      await x.fn();
      pass++;
      console.log(`PASS ${x.id}  ${x.title}`);
    } catch (e) {
      fail++;
      console.log(`FAIL ${x.id}  ${x.title}\n       -> ${e.message}`);
    }
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  server.close();
  await mongoose.disconnect();
  process.exit(fail ? 1 : 0);
})();
