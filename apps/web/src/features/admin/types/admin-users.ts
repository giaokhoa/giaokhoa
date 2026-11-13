
export interface NewUserDraft {
  username: string;
  email: string;
  password: string;
}

export interface UpdateUserDraft {
  email: string;
  firstName: string;
  lastName: string;
  password?: string;
}
