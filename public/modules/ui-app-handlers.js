export function createAppHandlerBinder({
  els,
  state,
  hideSessionExpiredModal,
  openAuthModal,
  showSessionExpiredModal,
  openUserProfileModal,
  closeUserProfileModal,
  closeLiveEventCheckinModal,
  saveUserDisplayName,
  updateAuthUI,
  requestPasswordReset,
} = {}) {
  let appHandlersBound = false;

  return function bindAppHandlers() {
    if (appHandlersBound) return;
    appHandlersBound = true;

    if (els.sessionExpiredSignInBtn) {
      els.sessionExpiredSignInBtn.addEventListener("click", () => {
        hideSessionExpiredModal();
        openAuthModal();
      });
    }
    if (els.sessionExpiredBackdrop) {
      els.sessionExpiredBackdrop.addEventListener("click", () => {
        showSessionExpiredModal();
      });
    }

    const openProfile = () => {
      if (!state.auth.currentUser) return;
      openUserProfileModal();
    };
    if (els.adminProfileToggleBtn) {
      els.adminProfileToggleBtn.addEventListener("click", openProfile);
    }
    if (els.judgeProfileToggleBtn) {
      els.judgeProfileToggleBtn.addEventListener("click", openProfile);
    }
    if (els.judgeOpenProfileToggleBtn) {
      els.judgeOpenProfileToggleBtn.addEventListener("click", openProfile);
    }
    if (els.userProfileClose) {
      els.userProfileClose.addEventListener("click", closeUserProfileModal);
    }
    if (els.userProfileCancelBtn) {
      els.userProfileCancelBtn.addEventListener("click", closeUserProfileModal);
    }
    if (els.userProfileBackdrop) {
      els.userProfileBackdrop.addEventListener("click", closeUserProfileModal);
    }
    if (els.liveEventCheckinClose) {
      els.liveEventCheckinClose.addEventListener("click", closeLiveEventCheckinModal);
    }
    if (els.liveEventCheckinBackdrop) {
      els.liveEventCheckinBackdrop.addEventListener("click", closeLiveEventCheckinModal);
    }
    if (els.userProfileForm) {
      els.userProfileForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!state.auth.currentUser) return;
        const name = els.userProfileNameInput?.value.trim() || "";
        if (els.userProfileStatus) {
          els.userProfileStatus.textContent = "Saving...";
        }
        try {
          await saveUserDisplayName(name);
          updateAuthUI();
          if (els.userProfileStatus) {
            els.userProfileStatus.textContent = "Saved.";
          }
          closeUserProfileModal();
        } catch (error) {
          console.error("Profile save failed", error);
          if (els.userProfileStatus) {
            els.userProfileStatus.textContent = "Unable to save profile.";
          }
        }
      });
    }
    const sendPasswordResetForCurrentUser = async (statusEl) => {
      if (!state.auth.currentUser) return;
      const email = String(state.auth.currentUser.email || state.auth.userProfile?.email || "").trim();
      if (!email) {
        if (statusEl) statusEl.textContent = "No account email found for password reset.";
        return;
      }
      if (statusEl) statusEl.textContent = "Sending reset email...";
      try {
        await requestPasswordReset(email);
        if (statusEl) {
          statusEl.textContent =
            "Password reset email sent. Check Spam/Junk if you do not see it soon.";
        }
      } catch (error) {
        console.error("Profile password reset failed", error);
        if (statusEl) statusEl.textContent = "Unable to send reset email. Try again.";
      }
    };
    if (els.userProfileResetPasswordBtn) {
      els.userProfileResetPasswordBtn.addEventListener("click", async () => {
        await sendPasswordResetForCurrentUser(els.userProfileResetPasswordStatus);
      });
    }
    if (els.directorProfileResetPasswordBtn) {
      els.directorProfileResetPasswordBtn.addEventListener("click", async () => {
        await sendPasswordResetForCurrentUser(els.directorProfileResetPasswordStatus);
      });
    }
  };
}
