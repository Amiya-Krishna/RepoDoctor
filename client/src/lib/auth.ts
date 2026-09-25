export const getToken = () => {
  return localStorage.getItem("token");
};

export const authHeaders = () => {
  const token = getToken();

  return {
    Authorization: `Bearer ${token}`,
  };
};