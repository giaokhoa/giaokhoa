package com.giaokhoa.authorization.permission;

import java.util.Arrays;
import java.util.List;

/**
 * Nguồn sự thật duy nhất về scope của từng loại target theo hợp đồng authorization. Template native
 * và các điểm kiểm tra eligibility đều suy ra danh sách scope từ đây; không nơi nào khác được chép
 * lại tên scope dạng literal.
 */
public final class PermissionCatalog {

    @FunctionalInterface
    public interface Scope {
        String scopeName();
    }

    public enum PlatformScope implements Scope {
        CENTER_CREATE("center.create"),
        CENTER_LIST("center.list"),
        SUBSCRIPTION_CONFIRM("subscription.confirm"),
        ACCOUNT_RECOVER("account.recover"),
        FIXTURE_MANAGE("fixture.manage");

        private final String value;

        PlatformScope(String value) {
            this.value = value;
        }

        @Override
        public String scopeName() {
            return value;
        }
    }

    public enum ProfileScope implements Scope {
        PROFILE_READ("profile.read"),
        WORKSPACE_LIST("workspace.list"),
        RECOVERY_REQUEST("recovery.request"),
        HISTORY_READ("history.read");

        private final String value;

        ProfileScope(String value) {
            this.value = value;
        }

        @Override
        public String scopeName() {
            return value;
        }
    }

    public enum WorkspaceScope implements Scope {
        ENTER("enter"),
        READ("read"),
        CLASS_LIST("class.list"),
        CLASS_CREATE("class.create"),
        MEMBERSHIP_LIST("membership.list"),
        MEMBERSHIP_INVITE("membership.invite"),
        MEMBERSHIP_ROLE_ASSIGN("membership.role.assign"),
        MEMBERSHIP_ROLE_REVOKE("membership.role.revoke"),
        MEMBERSHIP_REVOKE("membership.revoke"),
        MANAGER_ASSIGN("manager.assign"),
        MANAGER_REVOKE("manager.revoke"),
        STUDENT_ISSUE("student.issue"),
        GUARDIAN_REQUEST("guardian.request"),
        GUARDIAN_APPROVE("guardian.approve"),
        GUARDIAN_REVOKE("guardian.revoke");

        private final String value;

        WorkspaceScope(String value) {
            this.value = value;
        }

        @Override
        public String scopeName() {
            return value;
        }
    }

    public enum ClassScope implements Scope {
        READ("read"),
        UPDATE("update"),
        COURSE_LIST("course.list"),
        COURSE_CREATE("course.create"),
        ROSTER_READ("roster.read"),
        ROSTER_ADD("roster.add"),
        ROSTER_REVOKE("roster.revoke"),
        HOMEROOM_ASSIGN("homeroom.assign"),
        HOMEROOM_REVOKE("homeroom.revoke"),
        COMPLETION_READ("completion.read");

        private final String value;

        ClassScope(String value) {
            this.value = value;
        }

        @Override
        public String scopeName() {
            return value;
        }
    }

    public enum CourseScope implements Scope {
        READ("read"),
        UPDATE("update"),
        SUBJECT_ADD("subject.add");

        private final String value;

        CourseScope(String value) {
            this.value = value;
        }

        @Override
        public String scopeName() {
            return value;
        }
    }

    public enum CourseSubjectScope implements Scope {
        READ("read"),
        ROSTER_READ("roster.read"),
        ENROLLMENT_ADD("enrollment.add"),
        ENROLLMENT_REVOKE("enrollment.revoke"),
        TEACHER_ASSIGN("teacher.assign"),
        TEACHER_REVOKE("teacher.revoke"),
        RESOURCE_CREATE("resource.create"),
        ACTIVITY_ASSIGN("activity.assign"),
        COMPLETION_READ("completion.read");

        private final String value;

        CourseSubjectScope(String value) {
            this.value = value;
        }

        @Override
        public String scopeName() {
            return value;
        }
    }

    public enum ResourceVersionScope implements Scope {
        CONTENT_READ("content.read"),
        ANSWER_READ("answer.read"),
        USE("use"),
        FORK("fork"),
        SHARE("share"),
        LIBRARY_SAVE("library.save"),
        REVIEW("review"),
        PRACTICE("practice");

        private final String value;

        ResourceVersionScope(String value) {
            this.value = value;
        }

        @Override
        public String scopeName() {
            return value;
        }
    }

    public enum ResourceScope implements Scope {
        DRAFT_EDIT("draft.edit"),
        VERSION_CREATE("version.create");

        private final String value;

        ResourceScope(String value) {
            this.value = value;
        }

        @Override
        public String scopeName() {
            return value;
        }
    }

    public enum ActivityScope implements Scope {
        READ("read"),
        SUBMIT("submit"),
        SCHEDULE_EXTEND("schedule.extend"),
        ATTEMPT_OPEN("attempt.open"),
        REASSIGN("reassign");

        private final String value;

        ActivityScope(String value) {
            this.value = value;
        }

        @Override
        public String scopeName() {
            return value;
        }
    }

    public enum ResultScope implements Scope {
        READ("read"),
        READ_PUBLISHED("read.published"),
        GRADE("grade"),
        PUBLISH("publish");

        private final String value;

        ResultScope(String value) {
            this.value = value;
        }

        @Override
        public String scopeName() {
            return value;
        }
    }

    public enum GrantScope implements Scope {
        ACCEPT("accept"),
        REVOKE("revoke");

        private final String value;

        GrantScope(String value) {
            this.value = value;
        }

        @Override
        public String scopeName() {
            return value;
        }
    }

    private PermissionCatalog() {}

    public static List<String> names(Scope... scopes) {
        return Arrays.stream(scopes).map(Scope::scopeName).toList();
    }
}
