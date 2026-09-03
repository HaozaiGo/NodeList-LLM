import { create } from "zustand";
import { login as apiLogin, loginWithGoogle as apiLoginWithGoogle, register as apiRegister, type AuthResponse } from "@/lib/api";

function saveAuth(data: AuthResponse) {
  localStorage.setItem("nodelist_token", data.access_token);
  localStorage.setItem("nodelist_user_id", data.user_id);
  localStorage.setItem("nodelist_email", data.email);
  return { token: data.access_token, userId: data.user_id, email: data.email };
}

interface AuthState {
  token: string | null;
  userId: string | null;
  email: string | null;
  hydrated: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  loginWithGoogle: (credential: string) => Promise<void>;
  logout: () => void;
  hydrate: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  token: null,
  userId: null,
  email: null,
  hydrated: false,

  hydrate: () => {
    const token = localStorage.getItem("nodelist_token");
    const userId = localStorage.getItem("nodelist_user_id");
    const email = localStorage.getItem("nodelist_email");
    set({ token, userId, email, hydrated: true });
  },

  login: async (email, password) => {
    const data = await apiLogin(email, password);
    set(saveAuth(data));
  },

  register: async (email, password) => {
    const data = await apiRegister(email, password);
    set(saveAuth(data));
  },

  loginWithGoogle: async (credential) => {
    const data = await apiLoginWithGoogle(credential);
    set(saveAuth(data));
  },

  logout: () => {
    localStorage.removeItem("nodelist_token");
    localStorage.removeItem("nodelist_user_id");
    localStorage.removeItem("nodelist_email");
    set({ token: null, userId: null, email: null });
  },
}));
