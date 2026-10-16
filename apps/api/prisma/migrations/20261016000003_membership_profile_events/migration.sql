-- Team page edits of a member's login email and name/phone go to the team
-- history (details: previous/new email, or the changed fields).
ALTER TYPE "MembershipEventType" ADD VALUE 'EMAIL_CHANGED';
ALTER TYPE "MembershipEventType" ADD VALUE 'PROFILE_CHANGED';
