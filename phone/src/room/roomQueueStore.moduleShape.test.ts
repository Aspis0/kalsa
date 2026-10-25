const LOCAL = "shape-check";

let mockStorage: {
  getItem: jest.Mock;
  setItem: jest.Mock;
  removeItem: jest.Mock;
};
let queueStore: typeof import("./roomQueueStore");

beforeEach(() => {
  jest.resetModules();
  mockStorage = {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
  };
  jest.doMock("@react-native-async-storage/async-storage", () => ({
    __esModule: true,
    default: mockStorage,
  }));
  queueStore = require("./roomQueueStore") as typeof import("./roomQueueStore");
});

test("queue operations use AsyncStorage's default export", async () => {
  const { deleteRoomQueue, loadRoomQueue, mutateRoomQueue } = queueStore;

  await expect(loadRoomQueue(LOCAL)).resolves.toEqual([]);
  await mutateRoomQueue(LOCAL, (items) => {
    items.push({
      clientMsgId: "m1",
      text: "hello",
      callAi: false,
      createdAt: 1,
      state: "queued",
    });
    return true;
  });
  await deleteRoomQueue(LOCAL);

  expect(mockStorage.getItem).toHaveBeenCalled();
  expect(mockStorage.setItem).toHaveBeenCalledTimes(1);
  expect(mockStorage.removeItem.mock.calls.map(([key]) => key)).toEqual(
    expect.arrayContaining([
      `kalsa.roomqueue.${LOCAL}`,
      `kalsa.roomqueue.${LOCAL}.damaged`,
    ]),
  );
});
