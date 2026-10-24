const Enrollment = require("../models/Enrollment");
const Course = require("../models/Course");
const httpError = require("../utils/httpError");
const { isObjectId } = require("../utils/objectId");
const { getLessonIds } = require("../utils/courseHelpers");

const enrollCourse = async (studentId, courseId, batchId = null) => {
  if (!isObjectId(String(courseId))) throw httpError(404, "Course not found");
  const course = await Course.findById(courseId);
  if (!course) throw httpError(404, "Course not found");

  // Check if already enrolled
  const existing = await Enrollment.findOne({
    student: studentId,
    course: courseId,
  });


  if (existing) {
    throw httpError(400, "Already enrolled in this course");
  }

  // FIX (BUG-014): a batch must exist inside this course
  if (batchId) {
    if (!isObjectId(String(batchId)) || !course.batches.id(batchId)) {
      throw httpError(400, "Invalid batch for this course");
    }
  }

  // Create new enrollment
  try {
    return await Enrollment.create({
      student: studentId,
      course: courseId,
      batchId: batchId || undefined,
      progress: { completedLessons: [], percent: 0 },
    });
  } catch (err) {
    // double-click / parallel request: the unique (student, course) index caught it
    if (err.code === 11000) throw httpError(400, "Already enrolled in this course");
    throw err;
  }
};

const getMyEnrollments = async (studentId) => {
  return Enrollment.find({ student: studentId })
    .populate("course", "title instructorName price category tags")
    .sort({ createdAt: -1 });
};

const completeLesson = async (studentId, enrollId, lessonId) => {
  if (!isObjectId(String(enrollId))) throw httpError(404, "Enrollment not found");
  const enrollment = await Enrollment.findById(enrollId);
  // FIX (BUG-013): students may only change their own enrollment
  // (404 instead of 403 so enrollment ids cannot be probed)
  if (!enrollment || String(enrollment.student) !== String(studentId)) {
    throw httpError(404, "Enrollment not found");
  }

  const course = await Course.findById(enrollment.course);
  if (!course) throw httpError(404, "Course no longer exists");

  // FIX (BUG-013): the lesson must belong to THIS course
  const lessonIds = getLessonIds(course);
  if (!isObjectId(String(lessonId)) || !lessonIds.includes(String(lessonId))) {
    throw httpError(400, "Lesson does not belong to this course");
  }

  // avoid duplicates
  const alreadyDone = enrollment.progress.completedLessons
    .map(String)
    .includes(String(lessonId));

  if (!alreadyDone) {
    enrollment.progress.completedLessons.push(lessonId);
  }

  // calculate percent (only count lessons that still exist in the course)
  const totalLessons = lessonIds.length;
  const completed = enrollment.progress.completedLessons
    .map(String)
    .filter((id) => lessonIds.includes(id)).length;
  enrollment.progress.percent =
    totalLessons === 0 ? 0 : Math.min(100, Math.round((completed / totalLessons) * 100));

  await enrollment.save();
  return enrollment;
};

module.exports = { enrollCourse, getMyEnrollments, completeLesson };
