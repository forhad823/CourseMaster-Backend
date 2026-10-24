// helpers for looking inside a course's syllabus

// returns the lesson sub-document with this id, or null
const findLesson = (course, lessonId) => {
  for (const mod of course.syllabus || []) {
    const lesson = mod.lessons.id(lessonId);
    if (lesson) return lesson;
  }
  return null;
};

// returns the ids (as strings) of every lesson in the course
const getLessonIds = (course) =>
  (course.syllabus || []).flatMap((mod) => (mod.lessons || []).map((l) => String(l._id)));

module.exports = { findLesson, getLessonIds };
