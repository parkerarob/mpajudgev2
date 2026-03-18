export function createAuthHandlerBinder({
  els,
  DEV_FLAGS,
  state,
  openAuthModal,
  setAuthView,
  closeAuthModal,
  setRoleHint,
  setAuthFormDisabled,
  setSavingState,
  signIn,
  requestPasswordReset,
  createDirectorAccount,
  setAuthSuccess,
  signOut,
} = {}) {
  let authHandlersBound = false;
  const mapSignInErrorMessage = (error) => {
    const code = String(error?.code || "").trim().toLowerCase();
    if (
      code.includes("invalid-credential") ||
      code.includes("wrong-password") ||
      code.includes("user-not-found") ||
      code.includes("invalid-email")
    ) {
      return "Sign-in failed: invalid email or password.";
    }
    if (code.includes("user-disabled")) {
      return "Sign-in failed: this account is disabled.";
    }
    if (code.includes("too-many-requests")) {
      return "Sign-in blocked temporarily due to too many attempts. Try again shortly.";
    }
    if (code.includes("network-request-failed")) {
      return "Sign-in failed: network error. Check connection and retry.";
    }
    return "Sign-in failed. Check email/password or reset your password.";
  };

  return function bindAuthHandlers() {
    if (authHandlersBound) return;
    authHandlersBound = true;

    if (els.signInBtn) {
      els.signInBtn.addEventListener("click", () => {
        openAuthModal();
        setAuthView("signIn");
      });
    }
    if (els.authModalBackdrop) {
      els.authModalBackdrop.addEventListener("click", closeAuthModal);
    }
    if (els.authModalClose) {
      els.authModalClose.addEventListener("click", closeAuthModal);
    }

    if (els.emailForm) {
      els.emailForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        setRoleHint("");
        try {
          setAuthFormDisabled(true);
          if (els.emailSignInBtn) {
            setSavingState(els.emailSignInBtn, true, "Signing in...");
          }
          await signIn(els.emailInput?.value, els.passwordInput?.value);
        } catch (error) {
          console.error("Email sign-in failed", error);
          setRoleHint(mapSignInErrorMessage(error));
        } finally {
          if (els.emailSignInBtn) {
            setSavingState(els.emailSignInBtn, false);
          }
          setAuthFormDisabled(false);
        }
      });
    }

    if (els.anonymousBtn) {
      if (!DEV_FLAGS.allowAnonymousSignIn) {
        els.anonymousBtn.style.display = "none";
      } else {
        els.anonymousBtn.addEventListener("click", async () => {
          try {
            await signIn("", "", { anonymous: true });
          } catch (error) {
            console.error("Anonymous sign-in failed", error);
            setRoleHint("Anonymous sign-in failed.");
          }
        });
      }
    }

    if (els.forgotPasswordBtn) {
      els.forgotPasswordBtn.addEventListener("click", async () => {
        const email = els.emailInput?.value.trim() || "";
        if (!email) {
          setRoleHint("Enter your email to request a password reset.");
          return;
        }
        try {
          await requestPasswordReset(email);
          setRoleHint("Password reset email sent. Check Spam/Junk if you do not see it soon.");
        } catch (error) {
          console.error("Password reset failed", error);
          setRoleHint("Password reset failed. Confirm the email and try again.");
        }
      });
    }

    if (els.showDirectorSignupBtn) {
      els.showDirectorSignupBtn.addEventListener("click", () => {
        setAuthView("director");
      });
    }

    if (els.backToSignInBtn) {
      els.backToSignInBtn.addEventListener("click", () => {
        setAuthView("signIn");
      });
    }

    if (els.directorSignupBtn) {
      els.directorSignupBtn.addEventListener("click", async () => {
        const email = els.directorEmailInput?.value.trim() || "";
        const password = els.directorPasswordInput?.value.trim() || "";
        const schoolId = els.directorSchoolSelect?.value || null;
        if (!email || !password) {
          setRoleHint("Provide email and password to create a director account.");
          return;
        }
        if (!schoolId) {
          setRoleHint("Select your school to complete director signup.");
          return;
        }
        const schoolValid = state.admin.schoolsList.some((school) => school.id === schoolId);
        if (!schoolValid) {
          setRoleHint("Selected school not found. Refresh and try again.");
          return;
        }
        try {
          await createDirectorAccount({ email, password, schoolId });
          setRoleHint("Director account created.");
          if (els.directorEmailInput) els.directorEmailInput.value = "";
          if (els.directorPasswordInput) els.directorPasswordInput.value = "";
          if (els.directorSchoolSelect) els.directorSchoolSelect.value = "";
          setAuthView("signIn");
          closeAuthModal();
          setAuthSuccess("Director account created. Please sign in.");
        } catch (error) {
          console.error("Director signup failed", error);
          const code = error?.code || "";
          if (code.includes("auth/email-already-in-use")) {
            setRoleHint("That email is already in use. Try signing in instead.");
          } else if (code.includes("auth/weak-password")) {
            setRoleHint("Password is too weak. Use at least 6 characters.");
          } else if (code.includes("auth/invalid-email")) {
            setRoleHint("Email address is invalid.");
          } else {
            setRoleHint("Director signup failed. Check inputs or try again.");
          }
        }
      });
    }

    if (els.signOutBtn) {
      els.signOutBtn.addEventListener("click", async () => {
        await signOut();
      });
    }

    const userMenu = document.getElementById("headerUserMenu");
    const userMenuBtn = document.getElementById("headerUserMenuBtn");
    const userMenuDropdown = document.getElementById("headerAuthButtons");
    if (userMenu && userMenuBtn) {
      userMenuBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const isOpen = userMenu.classList.toggle("is-open");
        userMenuBtn.setAttribute("aria-expanded", String(isOpen));
      });
      if (userMenuDropdown) {
        userMenuDropdown.addEventListener("click", () => {
          userMenu.classList.remove("is-open");
          userMenuBtn.setAttribute("aria-expanded", "false");
        });
      }
      document.addEventListener("click", () => {
        if (userMenu.classList.contains("is-open")) {
          userMenu.classList.remove("is-open");
          userMenuBtn.setAttribute("aria-expanded", "false");
        }
      });
    }
  };
}
