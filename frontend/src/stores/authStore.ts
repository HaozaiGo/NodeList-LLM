import { create } from "zustand";
import { login as apiLogin, register as apiRegister } from "@/lib/api";

interface AuthState {
  token: string | null;
  userId: string | null;
  email: string | null;
  hydrated: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
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
    localStorage.setItem("nodelist_token", data.access_token);
    localStorage.setItem("nodelist_user_id", data.user_id);
    localStorage.setItem("nodelist_email", data.email);
    set({ token: data.access_token, userId: data.user_id, email: data.email });
  },

  register: async (email, password) => {
    const data = await apiRegister(email, password);
    localStorage.setItem("nodelist_token", data.access_token);
    localStorage.setItem("nodelist_user_id", data.user_id);
    localStorage.setItem("nodelist_email", data.email);
    set({ token: data.access_token, userId: data.user_id, email: data.email });
  },

  logout: () => {
    localStorage.removeItem("nodelist_token");
    localStorage.removeItem("nodelist_user_id");
    localStorage.removeItem("nodelist_email");
    set({ token: null, userId: null, email: null });
  },
}));
