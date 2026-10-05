test("queue operations use AsyncStorage's default export", async () => {
  const mockStorage = {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
  };
  jest.doMock("@react-native-async-storage/async-storage", () => ({
    __esModule: true,
    default: mockStorage,
  }));

  const { deleteRoomQueue, loadRoomQueue, mutateRoomQueue } = require(
    "./roomQueueStore",
  ) as typeof import("./roomQueueStore");

  await expect(loadRoomQueue("shape-check")).resolves.toEqual([]);
  await mutateRoomQueue("shape-check", (items) => {
    items.push({
      clientMsgId: "m1",
      text: "hello",
      callAi: false,
      createdAt: 1,
      state: "queued",
    });
    return true;
  });
  await deleteRoomQueue("shape-check");

  expect(mockStorage.getItem).toHaveBeenCalled();
  expect(mockStorage.setItem).toHaveBeenCalledTimes(1);
  expect(mockStorage.removeItem).toHaveBeenCalledTimes(2);
});
