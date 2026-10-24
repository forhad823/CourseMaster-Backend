// service to handle admin-related operations

const Course = require("../models/Course");
const Enrollment = require("../models/Enrollment");
const AssignmentSubmission = require("../models/AssignmentSubmission");
const User = require("../models/User");
const QuizSubmission = require("../models/QuizSubmission");
const httpError = require("../utils/httpError");
const { isObjectId } = require("../utils/objectId");

const createCourse = async (payload) => {
  const course = await Course.create(payload);
  return course;
};

const updateCourse = async (id, payload) => {
  if (!isObjectId(String(id))) throw httpError(404, "Course not found");

  let course;
  try {
    // FIX (BUG-019): runValidators makes updates obey the schema (e.g. price >= 0)
    course = await Course.findByIdAndUpdate(id, payload, {
      returnDocument: "after",
      runValidators: true,
    });
  } catch (err) {
    if (err.name === "ValidationError" || err.name === "CastError") {
      throw httpError(400, err.message);
    }
    throw err;
  }
  if (!course) throw httpError(404, "Course not found");
  return course;
};

const deleteCourse = async (id) => {
  if (!isObjectId(String(id))) throw httpError(404, "Course not found");
  const course = await Course.findByIdAndDelete(id);
  if (!course) throw httpError(404, "Course not found");

  // FIX (BUG-020): remove everything that pointed at the deleted course
  await Promise.all([
    Enrollment.deleteMany({ course: id }),
    QuizSubmission.deleteMany({ course: id }),
    AssignmentSubmission.deleteMany({ course: id }),
  ]);
  return { message: "Course deleted" };
};

// ✅ NEW: get enrollments (with optional filters)
const getEnrollments = async (query) => {
  const { courseId, batchId } = query;

  const filter = {};
  if (courseId) filter.course = courseId;
  if (batchId) filter.batchId = batchId;

  return Enrollment.find(filter)
    .populate("student", "name email")
    .populate("course", "title instructorName")
    .sort({ createdAt: -1 });
};

// ✅ NEW: get all assignment submissions
const getAssignments = async (query = {}) => {
  const filter = {};
 
  if (query.courseId) {
    if (!isObjectId(String(query.courseId))) throw httpError(400, "Invalid courseId");
    filter.course = query.courseId;
  }

  const submissions = await AssignmentSubmission.find(filter)
    .populate("student", "name email")
    .populate("course", "title syllabus")
    .populate("reviewer", "name")
    .sort({ createdAt: -1 });

  // Add lesson title to each submission
  const submissionsWithLessonTitle = submissions.map((sub) => {
    const submissionObj = sub.toObject();
    let lessonTitle = "Unknown Lesson";

    if (sub.course && sub.course.syllabus) {
      for (const module of sub.course.syllabus) {
        for (const lesson of module.lessons || []) {
          if (String(lesson._id) === String(sub.lessonId)) {
            lessonTitle = lesson.title;
            submissionObj.assignmentPrompt = lesson.assignmentPrompt || "";
            break;
          }
        }
        if (lessonTitle !== "Unknown Lesson") break;
      }
    }

    submissionObj.lessonTitle = lessonTitle;
    return submissionObj;
  });

  return submissionsWithLessonTitle;
};

// review/update an assignment submission (admin)
const reviewAssignment = async (id, payload = {}, adminId) => {
  const { reviewNotes, grade, status } = payload;

  if (!isObjectId(String(id))) throw httpError(404, "Submission not found");

  // FIX (BUG-019): validate review fields (findByIdAndUpdate skips schema validation)
  if (typeof grade !== "undefined") {
    if (typeof grade !== "number" || !Number.isFinite(grade) || grade < 0 || grade > 100) {
      throw httpError(400, "grade must be a number between 0 and 100");
    }
  }
  if (typeof status !== "undefined" && !["submitted", "reviewed"].includes(status)) {
    throw httpError(400, 'status must be "submitted" or "reviewed"');
  }
  if (typeof reviewNotes !== "undefined" && typeof reviewNotes !== "string") {
    throw httpError(400, "reviewNotes must be a string");
  }

  const update = {};
  if (typeof status !== "undefined") update.status = status;
  if (typeof reviewNotes !== "undefined") update.reviewNotes = reviewNotes;
  if (typeof grade !== "undefined") update.grade = grade;
  if (adminId) update.reviewer = adminId;

  const submission = await AssignmentSubmission.findByIdAndUpdate(id, update, {
    returnDocument: "after",
    runValidators: true,
  })
    .populate("student", "name email")
    .populate("course", "title")
    .populate("reviewer", "name");

  if (!submission) throw httpError(404, "Submission not found");

  return submission;
};

// Get analytics data for dashboard
const getAnalytics = async () => {
  // FIX (BUG-017): work in UTC end-to-end. Mongo stores createdAt in UTC, so
  // bucketing by local midnight + toISOString() shifted every day by the server's
  // UTC offset (e.g. Bangladesh, UTC+6) and today's enrollments never appeared.
  const DAY_MS = 24 * 60 * 60 * 1000;
  const now = new Date();
  const todayUTC = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const windowStart = new Date(todayUTC - 29 * DAY_MS); // 30 days including today

  const enrollments = await Enrollment.find({
    createdAt: { $gte: windowStart },
  })
    .select("createdAt")
    .sort({ createdAt: 1 })
    .lean();

  // Group by date
  const enrollmentData = {};
  enrollments.forEach((enrollment) => {
    const date = enrollment.createdAt.toISOString().split("T")[0];
    enrollmentData[date] = (enrollmentData[date] || 0) + 1;
  });

  // Convert to array format for chart (last 30 days)
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const chartData = [];
  for (let i = 29; i >= 0; i--) {
    const date = new Date(todayUTC - i * DAY_MS);
    const dateStr = date.toISOString().split("T")[0];

    // Format date for display (e.g., "Jan 15")
    const displayDate = `${monthNames[date.getUTCMonth()]} ${date.getUTCDate()}`;

    chartData.push({
      date: dateStr,
      displayDate: displayDate,
      enrollments: enrollmentData[dateStr] || 0,
    });
  }

  // Get total stats
  const totalEnrollments = await Enrollment.countDocuments();
  const totalCourses = await Course.countDocuments();
  const totalStudents = await User.countDocuments({ role: "student" });
  const totalInstructors = await User.countDocuments({ role: "admin" }); // Assuming admins are instructors

  // Get enrollments by course (top 5)
  const enrollmentsByCourse = await Enrollment.aggregate([
    {
      $group: {
        _id: "$course",
        count: { $sum: 1 }
      }
    },
    {
      $sort: { count: -1 }
    },
    {
      $limit: 5
    },
    {
      $lookup: {
        from: "courses",
        localField: "_id",
        foreignField: "_id",
        as: "courseInfo"
      }
    },
    {
      $unwind: "$courseInfo"
    },
    {
      $project: {
        courseName: "$courseInfo.title",
        enrollments: "$count"
      }
    }
  ]);

  return {
    chartData,
    enrollmentsByCourse,
    stats: {
      totalEnrollments,
      totalCourses,
      totalStudents,
      totalInstructors,
      enrollmentsLast30Days: enrollments.length
    }
  };
};

module.exports = {
  createCourse,
  updateCourse,
  deleteCourse,
  getEnrollments,
  getAssignments,
  reviewAssignment,
  getAnalytics,
};
