interface User {
  id: string;
  name: string;
}

const users: User[] = [
  {
    id: "1",
    name: "Amiya",
  },
];

export const getUser = (
  id: string
): User | undefined => {
  return users.find(
    (user) => user.id === id
  );
};

export const getUserName = (
  id: string
): string => {
  const user = getUser(id);

  return user.name;
};