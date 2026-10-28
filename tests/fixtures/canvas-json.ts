/**
 * Builders that turn compact fixture specs into the exact JSON that Canvas sends.
 *
 * The rules mirror canvas-lms at commit 1c9f0bb:
 * - `Submission#missing?`, `#late?`, `#graded?` and `#seconds_late` (app/models/submission.rb);
 * - `planner_item_json`, `submission_statuses` and the html_url helpers (lib/api/v1/planner_item.rb);
 * - `planner_override_json` and `PlannerOverride#associated_assignment_id`;
 * - `assignment_json`, `submission_json`, `locked_json` and `calculate_availability_status`.
 * Every computed field depends only on the spec and the fixture `now`.
 */
import type { LatePolicyStatus, PlannableType, PlannerNote } from '../../src/lib/canvas/types';
import { canvasDateTimeText, isBefore, secondsBetween } from './time';
import type {
  WireAssignment,
  WireAttachment,
  WireAvailabilityStatus,
  WireCheckpoint,
  WireCourse,
  WireDiscussionTopic,
  WireEnrollment,
  WireExternalToolTag,
  WireGroup,
  WireLockInfo,
  WirePlannerItem,
  WirePlannerOverride,
  WirePlannerSubmissions,
  WireSubmission,
  WireTerm,
} from './wire-types';

/** Facts shared by every builder. */
export interface FixtureContext {
  origin: string;
  now: string;
  timeZone: string;
  userId: string;
  userName: string;
  teacherId: string;
  teacherName: string;
}

// ---------------------------------------------------------------------------
// Courses, terms and groups
// ---------------------------------------------------------------------------

export interface TermSpec {
  id: string;
  name: string;
  startAt: string | null;
  endAt: string | null;
  createdAt: string;
}

export interface CourseSpec {
  id: string;
  /** The real course name. */
  name: string;
  /** The student's nickname, when one is set. Canvas then sends it as `name`. */
  nickname?: string;
  courseCode: string;
  term: TermSpec;
  createdAt: string;
  defaultView: WireCourse['default_view'];
}

export function termJson(term: TermSpec): WireTerm {
  return {
    id: term.id,
    name: term.name,
    start_at: term.startAt,
    end_at: term.endAt,
    created_at: term.createdAt,
    workflow_state: 'active',
    grading_period_group_id: null,
  };
}

export function courseJson(ctx: FixtureContext, spec: CourseSpec): WireCourse {
  const enrollment: WireEnrollment = {
    type: 'student',
    role: 'StudentEnrollment',
    role_id: '3',
    user_id: ctx.userId,
    enrollment_state: 'active',
    limit_privileges_to_course_section: false,
  };
  return {
    id: spec.id,
    name: spec.nickname ?? spec.name,
    ...(spec.nickname === undefined ? {} : { original_name: spec.name }),
    account_id: '12',
    uuid: fakeUuid(`c${spec.id}`),
    start_at: null,
    grading_standard_id: null,
    is_public: false,
    created_at: spec.createdAt,
    course_code: spec.courseCode,
    default_view: spec.defaultView,
    root_account_id: '1',
    enrollment_term_id: spec.term.id,
    license: 'private',
    grade_passback_setting: null,
    end_at: null,
    public_syllabus: false,
    public_syllabus_to_auth: false,
    storage_quota_mb: 500,
    is_public_to_auth_users: false,
    homeroom_course: false,
    course_color: null,
    friendly_name: null,
    apply_assignment_group_weights: true,
    calendar: { ics: `${ctx.origin}/feeds/calendars/course_${fakeUuid(`f${spec.id}`)}.ics` },
    time_zone: ctx.timeZone,
    blueprint: false,
    template: false,
    enrollments: [enrollment],
    hide_final_grades: false,
    workflow_state: 'available',
    restrict_enrollments_to_course_dates: false,
    term: termJson(spec.term),
  };
}

export interface GroupSpec {
  id: string;
  name: string;
  categoryId: string;
  createdAt: string;
  membersCount: number;
  context:
    | { type: 'Course'; courseId: string; name: string }
    | { type: 'Account'; accountId: string; name: string };
}

export function groupJson(spec: GroupSpec): WireGroup {
  const contextFields =
    spec.context.type === 'Course'
      ? { context_type: 'Course' as const, course_id: spec.context.courseId }
      : { context_type: 'Account' as const, account_id: spec.context.accountId };
  return {
    id: spec.id,
    name: spec.name,
    created_at: spec.createdAt,
    max_membership: null,
    is_public: false,
    join_level: 'invitation_only',
    group_category_id: spec.categoryId,
    description: null,
    members_count: spec.membersCount,
    storage_quota_mb: 50,
    ...contextFields,
    context_name: spec.context.name,
    avatar_url: null,
    role: null,
    leader: null,
    has_submission: false,
    concluded: false,
    non_collaborative: false,
  };
}

// ---------------------------------------------------------------------------
// Submissions
// ---------------------------------------------------------------------------

export interface SubmissionSpec {
  /** The hand-in time, or null when nothing was handed in. */
  submittedAt?: string | null;
  /** A posted score. A score makes the submission `graded`. */
  score?: number | null;
  grade?: string | null;
  gradedAt?: string | null;
  graderId?: string | null;
  excused?: boolean | null;
  latePolicyStatus?: LatePolicyStatus;
  customGradeStatusId?: string | null;
  redoRequest?: boolean;
  /** The last teacher comment, when the teacher left one. */
  feedback?: string;
  /** False when the student has not seen the feedback yet. */
  feedbackRead?: boolean;
}

/** The submission facts that Canvas derives from a spec at `now`. */
export interface SubmissionFacts {
  workflowState: 'unsubmitted' | 'submitted' | 'graded';
  submitted: boolean;
  graded: boolean;
  excused: boolean;
  missing: boolean;
  late: boolean;
  secondsLate: number;
  needsGrading: boolean;
  postedAt: string | null;
}

/** Submission types for which Canvas never computes "missing" (Submission.missing scope). */
const NO_DIGITAL_SUBMISSION = new Set([
  '',
  'none',
  'not_graded',
  'on_paper',
  'wiki_page',
  'external_tool',
  'ams',
]);

function expectsDigitalSubmission(submissionTypes: string[]): boolean {
  return !NO_DIGITAL_SUBMISSION.has(submissionTypes.join(','));
}

export function submissionFacts(
  spec: SubmissionSpec,
  assignment: { due: string | null; submissionTypes: string[]; newQuiz: boolean },
  now: string,
): SubmissionFacts {
  const submittedAt = spec.submittedAt ?? null;
  const excused = spec.excused === true;
  const hasScore = spec.score !== undefined && spec.score !== null;
  const workflowState =
    excused || hasScore ? 'graded' : submittedAt === null ? 'unsubmitted' : 'submitted';
  const latePolicy = spec.latePolicyStatus ?? null;
  const custom = spec.customGradeStatusId ?? null;
  const timeOfSubmission = submittedAt ?? now;
  const secondsLate =
    latePolicy === 'late' || assignment.due === null || !isBefore(assignment.due, timeOfSubmission)
      ? 0
      : secondsBetween(assignment.due, timeOfSubmission);
  return {
    workflowState,
    submitted: submittedAt !== null,
    graded: excused || (hasScore && workflowState === 'graded'),
    excused,
    missing: computeMissing(spec, assignment, secondsLate),
    late:
      excused || custom !== null
        ? false
        : latePolicy !== null
          ? latePolicy === 'late'
          : submittedAt !== null && secondsLate > 0,
    secondsLate,
    needsGrading: submittedAt !== null && workflowState === 'submitted' && !excused,
    postedAt: workflowState === 'graded' ? (spec.gradedAt ?? null) : null,
  };
}

function computeMissing(
  spec: SubmissionSpec,
  assignment: { submissionTypes: string[]; newQuiz: boolean },
  secondsLate: number,
): boolean {
  const latePolicy = spec.latePolicyStatus ?? null;
  if (spec.excused === true) return false;
  if ((spec.customGradeStatusId ?? null) !== null) return false;
  if ((spec.graderId ?? null) !== null && latePolicy === null) return false;
  if (latePolicy !== null) return latePolicy === 'missing';
  if ((spec.submittedAt ?? null) !== null) return false;
  if (secondsLate <= 0) return false;
  return assignment.newQuiz || expectsDigitalSubmission(assignment.submissionTypes);
}

// ---------------------------------------------------------------------------
// Assignments
// ---------------------------------------------------------------------------

export interface ToolSpec {
  url: string;
  toolId: string;
  resourceLinkTitle: string;
  newTab: boolean;
}

export interface TopicSpec {
  id: string;
  postedAt: string;
  message: string;
  unreadCount: number;
  entryCount: number;
}

export interface CheckpointSpec {
  /** The SubAssignment id. */
  id: string;
  tag: 'reply_to_topic' | 'reply_to_entry';
  due: string;
  points: number;
  submission: SubmissionSpec;
  override?: OverrideSpec;
}

export interface PeerReviewSubSpec {
  /** The PeerReviewSubAssignment id. */
  id: string;
  due: string;
  points: number;
  submission: SubmissionSpec;
}

export interface AssignmentSpec {
  id: string;
  courseId: string;
  name: string;
  assignmentGroupId: string;
  position: number;
  /** The student's due date after overrides. Null when undated. */
  due: string | null;
  unlockAt?: string | null;
  lockAt?: string | null;
  points: number | null;
  gradingType?: WireAssignment['grading_type'];
  submissionTypes: string[];
  description?: string;
  createdAt: string;
  /** External tool assignments: the tool launch. New Quizzes use it too. */
  tool?: ToolSpec;
  newQuiz?: boolean;
  /** Classic graded quizzes: the quiz id. */
  quizId?: string;
  /** Graded discussions: the topic. */
  topic?: TopicSpec;
  /** Checkpointed discussions: the two checkpoints. The parent then has no due date. */
  checkpoints?: CheckpointSpec[];
  peerReviews?: { count: number; assignAt: string | null; sub?: PeerReviewSubSpec };
  submission: SubmissionSpec;
  override?: OverrideSpec;
}

export interface AssignmentJsonOptions {
  bucket?: WireAssignment['bucket'];
  /**
   * The request has `include[]=checkpoints` and the course has discussion checkpoints turned on.
   * Canvas then sends `has_sub_assignments` and `checkpoints` on every assignment.
   */
  includeCheckpoints?: boolean;
}

function assignmentFacts(spec: AssignmentSpec, now: string): SubmissionFacts {
  return submissionFacts(
    spec.submission,
    { due: spec.due, submissionTypes: spec.submissionTypes, newQuiz: spec.newQuiz === true },
    now,
  );
}

function lockState(
  ctx: FixtureContext,
  assetString: string,
  unlockAt: string | null,
  lockAt: string | null,
): { locked_for_user: boolean; lock_info?: WireLockInfo; lock_explanation?: string } {
  if (unlockAt !== null && isBefore(ctx.now, unlockAt)) {
    return {
      locked_for_user: true,
      lock_info: { asset_string: assetString, unlock_at: unlockAt },
      lock_explanation: `This assignment is locked until ${canvasDateTimeText(unlockAt, ctx.timeZone, ctx.now)}.`,
    };
  }
  if (lockAt !== null && isBefore(lockAt, ctx.now)) {
    return {
      locked_for_user: true,
      lock_info: { asset_string: assetString, lock_at: lockAt, can_view: true },
      lock_explanation: `This assignment was locked ${canvasDateTimeText(lockAt, ctx.timeZone, ctx.now)}.`,
    };
  }
  return { locked_for_user: false };
}

function availabilityStatus(
  now: string,
  unlockAt: string | null,
  lockAt: string | null,
): WireAvailabilityStatus | undefined {
  if (unlockAt !== null && isBefore(now, unlockAt)) return { status: 'pending', date: unlockAt };
  if (lockAt !== null && isBefore(lockAt, now)) return { status: 'closed', date: null };
  if (lockAt !== null) return { status: 'open', date: lockAt };
  return undefined;
}

function submissionTypeOf(spec: AssignmentSpec): string | null {
  if (spec.newQuiz === true || spec.tool !== undefined) return 'basic_lti_launch';
  const first = spec.submissionTypes[0] ?? null;
  return first === 'online_quiz' ||
    first === 'discussion_topic' ||
    first === 'online_upload' ||
    first === 'online_text_entry'
    ? first
    : null;
}

export function submissionJson(
  ctx: FixtureContext,
  spec: AssignmentSpec,
  submissionId: string,
): WireSubmission {
  const facts = assignmentFacts(spec, ctx.now);
  const sub = spec.submission;
  const submittedAt = sub.submittedAt ?? null;
  const submissionType = submittedAt === null ? null : submissionTypeOf(spec);
  const hasScore = sub.score !== undefined && sub.score !== null;
  const json: WireSubmission = {
    id: submissionId,
    user_id: ctx.userId,
    url: null,
    score: hasScore ? (sub.score ?? null) : null,
    grade: sub.grade ?? null,
    excused: sub.excused ?? null,
    attempt: submittedAt === null ? null : 1,
    submission_type: submissionType,
    submitted_at: submittedAt,
    body: null,
    assignment_id: spec.id,
    graded_at: sub.gradedAt ?? null,
    grade_matches_current_submission: true,
    grader_id: sub.graderId ?? null,
    workflow_state: facts.workflowState,
    late_policy_status: sub.latePolicyStatus ?? null,
    points_deducted: null,
    grading_period_id: null,
    cached_due_date: spec.due,
    extra_attempts: null,
    posted_at: facts.postedAt,
    redo_request: sub.redoRequest === true,
    sticker: null,
    custom_grade_status_id: sub.customGradeStatusId ?? null,
    late: facts.late,
    missing: facts.missing,
    seconds_late: facts.secondsLate,
    entered_grade: sub.grade ?? null,
    entered_score: hasScore ? (sub.score ?? null) : null,
    preview_url: `${ctx.origin}/courses/${spec.courseId}/assignments/${spec.id}/submissions/${ctx.userId}?preview=1&version=${submittedAt === null ? 0 : 1}`,
  };
  if (submissionType === 'online_quiz' && submittedAt !== null && spec.quizId !== undefined) {
    json.body = `user: ${ctx.userId}, quiz: ${spec.quizId}, score: ${hasScore ? (sub.score ?? 0).toFixed(1) : '0.0'}, time: ${submittedAt}`;
  }
  if (submissionType === 'online_upload' && submittedAt !== null) {
    json.attachments = [uploadAttachment(ctx, spec, submittedAt)];
  }
  if (submissionType === 'basic_lti_launch' && submittedAt !== null && spec.tool !== undefined) {
    json.url = `${ctx.origin}/courses/${spec.courseId}/external_tools/retrieve?assignment_id=${spec.id}&url=${encodeURIComponent(spec.tool.url)}`;
    json.external_tool_url = spec.tool.url;
  }
  return json;
}

function uploadAttachment(
  ctx: FixtureContext,
  spec: AssignmentSpec,
  submittedAt: string,
): WireAttachment {
  const id = `9${spec.id}`;
  const filename = `${slug(spec.name)}.pdf`;
  return {
    id,
    uuid: fakeToken(`a${id}`),
    folder_id: '7700',
    display_name: filename,
    filename,
    upload_status: 'success',
    'content-type': 'application/pdf',
    url: `${ctx.origin}/files/${id}/download?download_frd=1&verifier=${fakeToken(`v${id}`)}`,
    size: 248_331,
    created_at: submittedAt,
    updated_at: submittedAt,
    unlock_at: null,
    locked: false,
    hidden: false,
    lock_at: null,
    hidden_for_user: false,
    thumbnail_url: null,
    modified_at: submittedAt,
    mime_class: 'pdf',
    media_entry_id: null,
    category: 'uncategorized',
    locked_for_user: false,
    preview_url: null,
  };
}

function externalToolTag(spec: AssignmentSpec, tool: ToolSpec): WireExternalToolTag {
  return {
    url: tool.url,
    new_tab: tool.newTab,
    external_data: null,
    resource_link_id: fakeToken(`r${spec.id}`),
    resource_link_title: tool.resourceLinkTitle,
    content_type: 'ContextExternalTool',
    content_id: tool.toolId,
    custom_params: null,
  };
}

function checkpointJson(spec: AssignmentSpec, checkpoint: CheckpointSpec): WireCheckpoint {
  return {
    name: spec.name,
    tag: checkpoint.tag,
    points_possible: checkpoint.points,
    due_at: checkpoint.due,
    only_visible_to_overrides: false,
    overrides: [],
    unlock_at: null,
    lock_at: null,
  };
}

export function assignmentJson(
  ctx: FixtureContext,
  spec: AssignmentSpec,
  submissionId: string,
  options: AssignmentJsonOptions = {},
): WireAssignment {
  const unlockAt = spec.unlockAt ?? null;
  const lockAt = spec.lockAt ?? null;
  const facts = assignmentFacts(spec, ctx.now);
  const lock = lockState(ctx, `assignment_${spec.id}`, unlockAt, lockAt);
  const lockedUntilLater = lock.lock_info !== undefined && 'unlock_at' in lock.lock_info;
  const availability = availabilityStatus(ctx.now, unlockAt, lockAt);
  // Class-wide flags: the fixture assumes classmates have handed in and been graded once the due date passed.
  const classWorkExists =
    facts.submitted || facts.graded || (spec.due !== null && isBefore(spec.due, ctx.now));
  const json: WireAssignment = {
    id: spec.id,
    description: lockedUntilLater ? null : (spec.description ?? `<p>${spec.name}</p>`),
    due_at: spec.due,
    unlock_at: unlockAt,
    lock_at: lockAt,
    points_possible: spec.points,
    grading_type: spec.gradingType ?? 'points',
    assignment_group_id: spec.assignmentGroupId,
    grading_standard_id: null,
    created_at: spec.createdAt,
    updated_at: spec.createdAt,
    peer_reviews: spec.peerReviews !== undefined,
    automatic_peer_reviews: spec.peerReviews !== undefined,
    position: spec.position,
    grade_group_students_individually: false,
    anonymous_peer_reviews: false,
    group_category_id: null,
    post_to_sis: false,
    moderated_grading: false,
    omit_from_final_grade: false,
    intra_group_peer_reviews: false,
    anonymous_instructor_annotations: false,
    anonymous_grading: false,
    graders_anonymous_to_graders: false,
    grader_count: 0,
    grader_comments_visible_to_graders: true,
    final_grader_id: null,
    grader_names_visible_to_final_grader: true,
    allowed_attempts: -1,
    annotatable_attachment_id: null,
    hide_in_gradebook: false,
    suppress_assignment: false,
    secure_params: `eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.${fakeToken(`s${spec.id}`)}.${fakeToken(`t${spec.id}`)}`,
    lti_context_id: fakeUuid(`l${spec.id}`),
    course_id: spec.courseId,
    name: spec.name,
    submission_types: spec.submissionTypes,
    has_submitted_submissions: classWorkExists,
    due_date_required: false,
    max_name_length: 255,
    in_closed_grading_period: false,
    ...(availability === undefined ? {} : { availability_status: availability }),
    graded_submissions_exist: classWorkExists,
    is_quiz_assignment: spec.quizId !== undefined,
    can_duplicate: true,
    original_course_id: null,
    original_assignment_id: null,
    original_lti_resource_link_id: null,
    original_assignment_name: null,
    original_quiz_id: null,
    workflow_state: 'published',
    important_dates: false,
    muted: false,
    html_url: `${ctx.origin}/courses/${spec.courseId}/assignments/${spec.id}`,
    published: true,
    only_visible_to_overrides: false,
    visible_to_everyone: true,
    locked_for_user: lock.locked_for_user,
    submissions_download_url: `${ctx.origin}/courses/${spec.courseId}/assignments/${spec.id}/submissions?zip=1`,
    post_manually: false,
    anonymize_students: false,
    new_quizzes_anonymous_participants: false,
    require_lockdown_browser: false,
    restrict_quantitative_data: false,
  };
  if (spec.newQuiz === true) {
    json.is_quiz_lti_assignment = true;
    json.frozen_attributes = ['submission_types'];
    json.settings = null;
  }
  if (spec.tool !== undefined) {
    json.external_tool_tag_attributes = externalToolTag(spec, spec.tool);
    json.url = `${ctx.origin}/api/v1/courses/${spec.courseId}/external_tools/sessionless_launch?assignment_id=${spec.id}&launch_type=assessment`;
  }
  if (spec.quizId !== undefined) {
    json.quiz_id = spec.quizId;
    json.anonymous_submissions = false;
  }
  if (spec.peerReviews !== undefined) {
    json.peer_review_count = spec.peerReviews.count;
    json.peer_reviews_assign_at = spec.peerReviews.assignAt;
    json.intra_group_peer_reviews = false;
  }
  if (spec.topic !== undefined) {
    json.discussion_topic = discussionTopicJson(ctx, {
      courseId: spec.courseId,
      assignmentId: spec.id,
      title: spec.name,
      topic: spec.topic,
      todoDate: null,
      checkpointed: spec.checkpoints !== undefined,
    });
  }
  json.submission = submissionJson(ctx, spec, submissionId);
  if (options.bucket !== undefined) json.bucket = options.bucket;
  if (lock.lock_info !== undefined) json.lock_info = lock.lock_info;
  if (lock.lock_explanation !== undefined) json.lock_explanation = lock.lock_explanation;
  if (options.includeCheckpoints === true) {
    json.has_sub_assignments = spec.checkpoints !== undefined;
    json.checkpoints = (spec.checkpoints ?? []).map((checkpoint) =>
      checkpointJson(spec, checkpoint),
    );
  }
  return json;
}

export function discussionTopicJson(
  ctx: FixtureContext,
  input: {
    courseId: string;
    assignmentId: string | null;
    title: string;
    topic: TopicSpec;
    todoDate: string | null;
    checkpointed: boolean;
  },
): WireDiscussionTopic {
  const htmlUrl = `${ctx.origin}/courses/${input.courseId}/discussion_topics/${input.topic.id}`;
  const json: WireDiscussionTopic = {
    id: input.topic.id,
    title: input.title,
    assignment_id: input.assignmentId,
    delayed_post_at: null,
    lock_at: null,
    created_at: input.topic.postedAt,
    last_reply_at: input.topic.entryCount > 0 ? input.topic.postedAt : null,
    posted_at: input.topic.postedAt,
    root_topic_id: null,
    podcast_has_student_posts: false,
    discussion_type: 'threaded',
    position: null,
    allow_rating: false,
    only_graders_can_rate: false,
    sort_by_rating: false,
    is_section_specific: false,
    anonymous_state: null,
    summary_enabled: false,
    user_name: ctx.teacherName,
    discussion_subentry_count: input.topic.entryCount,
    require_initial_post: false,
    user_can_see_posts: true,
    podcast_url: null,
    read_state: input.topic.unreadCount > 0 ? 'unread' : 'read',
    unread_count: input.topic.unreadCount,
    subscribed: false,
    attachments: [],
    published: true,
    can_unpublish: false,
    locked: false,
    can_lock: true,
    comments_disabled: false,
    author: {
      id: ctx.teacherId,
      anonymous_id: 'nwq',
      display_name: ctx.teacherName,
      avatar_image_url: `${ctx.origin}/images/messages/avatar-50.png`,
      html_url: `${ctx.origin}/courses/${input.courseId}/users/${ctx.teacherId}`,
      pronouns: null,
    },
    html_url: htmlUrl,
    url: htmlUrl,
    pinned: false,
    group_category_id: null,
    can_group: false,
    topic_children: [],
    group_topic_children: [],
    locked_for_user: false,
    message: input.topic.message,
    todo_date: input.todoDate,
    is_announcement: false,
    sort_order: 'desc',
    sort_order_locked: false,
    expanded: false,
    expanded_locked: false,
  };
  if (input.checkpointed) {
    json.reply_to_entry_required_count = 2;
    json.is_checkpointed = true;
  }
  return json;
}

// ---------------------------------------------------------------------------
// Planner overrides
// ---------------------------------------------------------------------------

export interface OverrideSpec {
  id: string;
  markedComplete: boolean;
  dismissed: boolean;
  createdAt: string;
  updatedAt?: string;
}

/** Where an override points. `dbType` is the stored plannable type in snake case. */
export interface OverrideTarget {
  dbType: PlannableType;
  plannableId: string;
  /** `PlannerOverride#associated_assignment_id`. */
  assignmentId: string | null;
}

/**
 * One override as Canvas serializes it. `reportedType` is the type that `planner_override_json`
 * reports: the planner item's class for embedded overrides, and the stored type in the list.
 */
export function overrideJson(
  ctx: FixtureContext,
  spec: OverrideSpec,
  target: OverrideTarget,
  reportedType: PlannableType,
): WirePlannerOverride {
  return {
    id: spec.id,
    plannable_type: reportedType,
    plannable_id: target.plannableId,
    user_id: ctx.userId,
    workflow_state: 'active',
    marked_complete: spec.markedComplete,
    deleted_at: null,
    created_at: spec.createdAt,
    updated_at: spec.updatedAt ?? spec.createdAt,
    dismissed: spec.dismissed,
    assignment_id: target.assignmentId,
  };
}

// ---------------------------------------------------------------------------
// Planner items
// ---------------------------------------------------------------------------

export interface PlannerCourse {
  id: string;
  /** `context_name`: the nickname when set, otherwise the course name. */
  contextName: string;
}

function courseContext(course: PlannerCourse): Pick<WirePlannerItem, 'context_type' | 'course_id'> {
  return { context_type: 'Course', course_id: course.id };
}

function courseTail(
  course: PlannerCourse,
): Pick<WirePlannerItem, 'context_name' | 'context_image'> {
  return { context_name: course.contextName, context_image: null };
}

function plannerSubmissions(
  ctx: FixtureContext,
  spec: SubmissionSpec,
  facts: SubmissionFacts,
): WirePlannerSubmissions {
  const hasFeedback = spec.feedback !== undefined;
  const json: WirePlannerSubmissions = {
    submitted: facts.submitted,
    excused: facts.excused,
    graded: facts.graded,
    posted_at: facts.postedAt,
    late: facts.late,
    missing: facts.missing,
    needs_grading: facts.needsGrading,
    has_feedback: hasFeedback,
    redo_request: spec.redoRequest === true,
  };
  if (spec.feedback !== undefined) {
    json.feedback = {
      comment: spec.feedback,
      is_media: false,
      author_name: ctx.teacherName,
      author_avatar_url: `${ctx.origin}/images/messages/avatar-50.png`,
    };
  }
  return json;
}

function feedbackIsNew(spec: SubmissionSpec): boolean {
  return spec.feedback !== undefined && spec.feedbackRead !== true;
}

/** `assignment_html_url`: the submission page once there is a hand-in, a grade or feedback. */
function assignmentHtmlUrl(
  ctx: FixtureContext,
  courseId: string,
  assignmentId: string,
  submissions: WirePlannerSubmissions,
): string {
  return submissions.submitted || submissions.graded || submissions.has_feedback
    ? `/courses/${courseId}/assignments/${assignmentId}/submissions/${ctx.userId}`
    : `/courses/${courseId}/assignments/${assignmentId}`;
}

function embeddedOverride(
  ctx: FixtureContext,
  spec: OverrideSpec | undefined,
  target: OverrideTarget,
  reportedType: PlannableType,
): WirePlannerOverride | null {
  return spec === undefined ? null : overrideJson(ctx, spec, target, reportedType);
}

/** An assignment row: plain assignments, external tools, New Quizzes, on paper and no-submission columns. */
export function assignmentPlannerItem(
  ctx: FixtureContext,
  course: PlannerCourse,
  spec: AssignmentSpec,
): WirePlannerItem {
  const due = requireDue(spec);
  const facts = assignmentFacts(spec, ctx.now);
  const submissions = plannerSubmissions(ctx, spec.submission, facts);
  return {
    ...courseContext(course),
    plannable_id: spec.id,
    planner_override: embeddedOverride(
      ctx,
      spec.override,
      { dbType: 'assignment', plannableId: spec.id, assignmentId: spec.id },
      'assignment',
    ),
    plannable_type: 'assignment',
    new_activity: feedbackIsNew(spec.submission),
    submissions,
    plannable_date: due,
    plannable: {
      id: spec.id,
      title: spec.name,
      created_at: spec.createdAt,
      updated_at: spec.createdAt,
      points_possible: spec.points,
      due_at: due,
    },
    html_url: assignmentHtmlUrl(ctx, course.id, spec.id, submissions),
    ...courseTail(course),
  };
}

/** A classic graded quiz. Canvas reports the quiz id and type, and the embedded override as `assignment`. */
export function quizPlannerItem(
  ctx: FixtureContext,
  course: PlannerCourse,
  spec: AssignmentSpec,
): WirePlannerItem {
  const due = requireDue(spec);
  const quizId = required(spec.quizId, `quiz id of assignment ${spec.id}`);
  const facts = assignmentFacts(spec, ctx.now);
  return {
    ...courseContext(course),
    plannable_id: quizId,
    planner_override: embeddedOverride(
      ctx,
      spec.override,
      { dbType: 'quiz', plannableId: quizId, assignmentId: spec.id },
      'assignment',
    ),
    plannable_type: 'quiz',
    new_activity: feedbackIsNew(spec.submission),
    submissions: plannerSubmissions(ctx, spec.submission, facts),
    plannable_date: due,
    plannable: {
      id: quizId,
      title: spec.name,
      created_at: spec.createdAt,
      updated_at: spec.createdAt,
      assignment_id: spec.id,
      points_possible: spec.points,
      due_at: due,
    },
    html_url: `/courses/${course.id}/quizzes/${quizId}`,
    ...courseTail(course),
  };
}

/** A graded discussion. Canvas reports the topic id and type, and the embedded override as `assignment`. */
export function gradedDiscussionPlannerItem(
  ctx: FixtureContext,
  course: PlannerCourse,
  spec: AssignmentSpec,
): WirePlannerItem {
  const due = requireDue(spec);
  const topic = required(spec.topic, `topic of assignment ${spec.id}`);
  const facts = assignmentFacts(spec, ctx.now);
  const submissions = plannerSubmissions(ctx, spec.submission, facts);
  const htmlUrl =
    submissions.submitted || submissions.graded || submissions.has_feedback
      ? `/courses/${course.id}/assignments/${spec.id}/submissions/${ctx.userId}`
      : `/courses/${course.id}/discussion_topics/${topic.id}`;
  return {
    ...courseContext(course),
    plannable_id: topic.id,
    planner_override: embeddedOverride(
      ctx,
      spec.override,
      { dbType: 'discussion_topic', plannableId: topic.id, assignmentId: spec.id },
      'assignment',
    ),
    plannable_type: 'discussion_topic',
    new_activity: topic.unreadCount > 0,
    submissions,
    plannable_date: due,
    plannable: {
      id: topic.id,
      title: spec.name,
      todo_date: null,
      unread_count: topic.unreadCount,
      read_state: topic.unreadCount > 0 ? 'unread' : 'read',
      created_at: topic.postedAt,
      updated_at: topic.postedAt,
      assignment_id: spec.id,
      points_possible: spec.points,
      due_at: due,
    },
    html_url: htmlUrl,
    ...courseTail(course),
  };
}

/** One checkpoint of a checkpointed discussion, a `sub_assignment` row. */
export function subAssignmentPlannerItem(
  ctx: FixtureContext,
  course: PlannerCourse,
  parent: AssignmentSpec,
  checkpoint: CheckpointSpec,
): WirePlannerItem {
  const topic = required(parent.topic, `topic of assignment ${parent.id}`);
  const facts = submissionFacts(
    checkpoint.submission,
    { due: checkpoint.due, submissionTypes: ['discussion_topic'], newQuiz: false },
    ctx.now,
  );
  const submissions = plannerSubmissions(ctx, checkpoint.submission, facts);
  return {
    ...courseContext(course),
    plannable_id: checkpoint.id,
    planner_override: embeddedOverride(
      ctx,
      checkpoint.override,
      { dbType: 'sub_assignment', plannableId: checkpoint.id, assignmentId: null },
      'sub_assignment',
    ),
    plannable_type: 'sub_assignment',
    new_activity: topic.unreadCount > 0 || feedbackIsNew(checkpoint.submission),
    submissions,
    details: { reply_to_entry_required_count: 2 },
    plannable_date: checkpoint.due,
    plannable: {
      id: checkpoint.id,
      title: parent.name,
      unread_count: topic.unreadCount,
      read_state: topic.unreadCount > 0 ? 'unread' : 'read',
      created_at: parent.createdAt,
      updated_at: parent.createdAt,
      sub_assignment_tag: checkpoint.tag,
      points_possible: checkpoint.points,
      due_at: checkpoint.due,
    },
    html_url: assignmentHtmlUrl(ctx, course.id, parent.id, submissions),
    ...courseTail(course),
  };
}

/** A peer review in a course with peer review allocation and grading: a `peer_review_sub_assignment` row. */
export function peerReviewSubPlannerItem(
  ctx: FixtureContext,
  course: PlannerCourse,
  parent: AssignmentSpec,
  review: PeerReviewSubSpec,
  title: string,
): WirePlannerItem {
  const facts = submissionFacts(
    review.submission,
    { due: review.due, submissionTypes: ['online_text_entry'], newQuiz: false },
    ctx.now,
  );
  return {
    ...courseContext(course),
    plannable_id: review.id,
    planner_override: null,
    plannable_type: 'peer_review_sub_assignment',
    new_activity: feedbackIsNew(review.submission),
    submissions: plannerSubmissions(ctx, review.submission, facts),
    plannable_date: review.due,
    plannable: {
      id: review.id,
      title,
      created_at: parent.createdAt,
      updated_at: parent.createdAt,
      points_possible: review.points,
      due_at: review.due,
    },
    html_url: `/courses/${course.id}/assignments/${parent.id}/peer_reviews`,
    ...courseTail(course),
  };
}

export interface AssessmentRequestSpec {
  id: string;
  /** The reviewed assignment. */
  assignment: AssignmentSpec;
  /** `peer_reviews_due_at`, or the reviewer's own due date when that is null. */
  date: string;
  /** The user whose work the student reviews. */
  revieweeId: string;
  completed: boolean;
  createdAt: string;
}

/** An older-style peer review, an `assessment_request` row. */
export function assessmentRequestPlannerItem(
  ctx: FixtureContext,
  course: PlannerCourse,
  spec: AssessmentRequestSpec,
): WirePlannerItem {
  return {
    ...courseContext(course),
    plannable_id: spec.id,
    planner_override: null,
    plannable_type: 'assessment_request',
    new_activity: false,
    submissions: false,
    plannable_date: spec.date,
    plannable: {
      id: spec.id,
      title: spec.assignment.name,
      todo_date: spec.date,
      created_at: spec.createdAt,
      updated_at: spec.createdAt,
      workflow_state: spec.completed ? 'completed' : 'assigned',
    },
    html_url: `/courses/${course.id}/assignments/${spec.assignment.id}/submissions/${spec.revieweeId}`,
    ...courseTail(course),
  };
}

export interface UngradedTopicSpec {
  id: string;
  title: string;
  todoDate: string;
  postedAt: string;
  unreadCount: number;
  override?: OverrideSpec;
}

/** An ungraded discussion with a to-do date, in a course or in a group. */
export function ungradedDiscussionPlannerItem(
  ctx: FixtureContext,
  context:
    | { type: 'Course'; course: PlannerCourse }
    | { type: 'Group'; groupId: string; groupName: string },
  spec: UngradedTopicSpec,
): WirePlannerItem {
  const head =
    context.type === 'Course'
      ? courseContext(context.course)
      : { context_type: 'Group' as const, group_id: context.groupId };
  const tail =
    context.type === 'Course' ? courseTail(context.course) : { context_name: context.groupName };
  const base =
    context.type === 'Course' ? `/courses/${context.course.id}` : `/groups/${context.groupId}`;
  return {
    ...head,
    plannable_id: spec.id,
    planner_override: embeddedOverride(
      ctx,
      spec.override,
      { dbType: 'discussion_topic', plannableId: spec.id, assignmentId: null },
      'discussion_topic',
    ),
    plannable_type: 'discussion_topic',
    new_activity: spec.unreadCount > 0,
    submissions: false,
    plannable_date: spec.todoDate,
    plannable: {
      id: spec.id,
      title: spec.title,
      todo_date: spec.todoDate,
      unread_count: spec.unreadCount,
      read_state: spec.unreadCount > 0 ? 'unread' : 'read',
      created_at: spec.postedAt,
      updated_at: spec.postedAt,
      assignment_id: null,
    },
    html_url: `${base}/discussion_topics/${spec.id}`,
    ...tail,
  };
}

export interface PageSpec {
  id: string;
  title: string;
  slug: string;
  todoDate: string;
  createdAt: string;
  override?: OverrideSpec;
}

/** A page with a to-do date. */
export function pagePlannerItem(
  ctx: FixtureContext,
  course: PlannerCourse,
  spec: PageSpec,
): WirePlannerItem {
  return {
    ...courseContext(course),
    plannable_id: spec.id,
    planner_override: embeddedOverride(
      ctx,
      spec.override,
      { dbType: 'wiki_page', plannableId: spec.id, assignmentId: null },
      'wiki_page',
    ),
    plannable_type: 'wiki_page',
    new_activity: false,
    submissions: false,
    plannable_date: spec.todoDate,
    plannable: {
      id: spec.id,
      title: spec.title,
      todo_date: spec.todoDate,
      url: spec.slug,
      created_at: spec.createdAt,
      updated_at: spec.createdAt,
    },
    html_url: `/courses/${course.id}/pages/${spec.slug}`,
    ...courseTail(course),
  };
}

export interface NoteSpec {
  id: string;
  title: string;
  details: string | null;
  todoDate: string;
  course: PlannerCourse | null;
  createdAt: string;
  override?: OverrideSpec;
}

/** A custom task. Canvas sends no context fields and no html_url for planner notes. */
export function notePlannerItem(ctx: FixtureContext, spec: NoteSpec): WirePlannerItem {
  return {
    plannable_id: spec.id,
    planner_override: embeddedOverride(
      ctx,
      spec.override,
      { dbType: 'planner_note', plannableId: spec.id, assignmentId: null },
      'planner_note',
    ),
    plannable_type: 'planner_note',
    new_activity: false,
    submissions: false,
    plannable_date: spec.todoDate,
    plannable: {
      id: spec.id,
      title: spec.title,
      course_id: spec.course?.id ?? null,
      todo_date: spec.todoDate,
      details: spec.details,
      created_at: spec.createdAt,
      updated_at: spec.createdAt,
      user_id: ctx.userId,
    },
    ...(spec.course === null ? {} : courseTail(spec.course)),
  };
}

/** A custom task from `GET /api/v1/planner_notes`, as lib/api/v1/planner_note.rb serializes it. */
export function plannerNoteJson(ctx: FixtureContext, spec: NoteSpec): PlannerNote {
  return {
    id: spec.id,
    todo_date: spec.todoDate,
    title: spec.title,
    details: spec.details,
    user_id: ctx.userId,
    course_id: spec.course?.id ?? null,
    workflow_state: 'active',
    created_at: spec.createdAt,
    updated_at: spec.createdAt,
  };
}

export interface CalendarEventSpec {
  id: string;
  title: string;
  startAt: string;
  endAt: string;
  allDay: boolean;
  locationName: string | null;
  description: string | null;
  createdAt: string;
  context:
    | { type: 'Course'; course: PlannerCourse }
    | { type: 'User' }
    | { type: 'Account'; accountId: string; name: string };
}

/** A calendar event. The extension drops these. */
export function calendarEventPlannerItem(
  ctx: FixtureContext,
  spec: CalendarEventSpec,
): WirePlannerItem {
  const head =
    spec.context.type === 'Course'
      ? courseContext(spec.context.course)
      : spec.context.type === 'User'
        ? { context_type: 'User' as const, user_id: ctx.userId }
        : { context_type: 'Account' as const, account_id: spec.context.accountId };
  const contextCode =
    spec.context.type === 'Course'
      ? `course_${spec.context.course.id}`
      : spec.context.type === 'User'
        ? `user_${ctx.userId}`
        : `account_${spec.context.accountId}`;
  const tail =
    spec.context.type === 'Course'
      ? courseTail(spec.context.course)
      : spec.context.type === 'User'
        ? { context_name: ctx.userName }
        : { context_name: spec.context.name };
  return {
    ...head,
    plannable_id: spec.id,
    planner_override: null,
    plannable_type: 'calendar_event',
    new_activity: false,
    submissions: false,
    plannable_date: spec.startAt,
    plannable: {
      id: spec.id,
      title: spec.title,
      location_name: spec.locationName,
      created_at: spec.createdAt,
      updated_at: spec.createdAt,
      all_day: spec.allDay,
      location_address: null,
      description: spec.description,
      start_at: spec.startAt,
      end_at: spec.endAt,
    },
    html_url: `/calendar?event_id=${spec.id}&include_contexts=${contextCode}`,
    ...tail,
  };
}

export interface AnnouncementSpec {
  id: string;
  title: string;
  postedAt: string;
  read: boolean;
}

/** A course announcement. The extension drops these. */
export function announcementPlannerItem(
  course: PlannerCourse,
  spec: AnnouncementSpec,
): WirePlannerItem {
  return {
    ...courseContext(course),
    plannable_id: spec.id,
    planner_override: null,
    plannable_type: 'announcement',
    new_activity: !spec.read,
    submissions: false,
    plannable_date: spec.postedAt,
    plannable: {
      id: spec.id,
      title: spec.title,
      unread_count: 0,
      read_state: spec.read ? 'read' : 'unread',
      created_at: spec.postedAt,
      updated_at: spec.postedAt,
    },
    html_url: `/courses/${course.id}/discussion_topics/${spec.id}`,
    ...courseTail(course),
  };
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function requireDue(spec: AssignmentSpec): string {
  return required(spec.due, `due date of assignment ${spec.id}`);
}

function required<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined)
    throw new Error(`Fixture spec is missing the ${what}.`);
  return value;
}

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** A stable 32-bit hash, for fake tokens that never change between runs. */
function hash32(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

function hex(seed: string, length: number): string {
  let out = '';
  let round = 0;
  while (out.length < length) {
    out += hash32(`${seed}:${round}`).toString(16).padStart(8, '0');
    round += 1;
  }
  return out.slice(0, length);
}

/** A stable fake UUID derived from `seed`. */
export function fakeUuid(seed: string): string {
  const h = hex(seed, 32);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** A stable fake opaque token derived from `seed`. */
export function fakeToken(seed: string): string {
  return hex(seed, 40);
}
