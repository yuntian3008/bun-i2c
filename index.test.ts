import { describe, expect, test } from "bun:test";
import { BunI2C, type NativeI2C } from "./index";

function createMock(overrides: Partial<NativeI2C> = {}): NativeI2C {
  return {
    open: () => 1,
    ioctl: () => 0,
    read: (fd, buf, count) => {
      const data = [0xab, 0xcd, 0xef];
      buf.set(data.slice(0, Math.min(count, data.length)));
      return Math.min(count, data.length);
    },
    write: (fd, buf, count) => count,
    close: () => 0,
    ...overrides,
  };
}

describe("BunI2C", () => {
  test("constructor succeeds with mock native", () => {
    const mock = createMock();
    const i2c = new BunI2C("/dev/i2c-1", mock);
    expect(i2c).toBeDefined();
    i2c.close();
  });

  test("constructor throws when open fails", () => {
    const mock = createMock({ open: () => -1 });
    expect(() => new BunI2C("/dev/i2c-1", mock)).toThrow(
      /BunI2C: Failed to open I2C bus '\/dev\/i2c-1'/
    );
  });

  test("setAddress throws when ioctl fails", () => {
    const mock = createMock({ ioctl: () => -1 });
    const i2c = new BunI2C("/dev/i2c-1", mock);
    expect(() => i2c.setAddress(0x3c)).toThrow(
      /ioctl\(I2C_SLAVE\) failed for address 0x3C/
    );
    i2c.close();
  });

  test("setAddress succeeds with mock", () => {
    const mock = createMock();
    const i2c = new BunI2C("/dev/i2c-1", mock);
    expect(() => i2c.setAddress(0x3c)).not.toThrow();
    i2c.close();
  });

  test("writeBuffer throws when write fails", () => {
    const mock = createMock({ write: () => -1 });
    const i2c = new BunI2C("/dev/i2c-1", mock);
    expect(() => i2c.writeBuffer(new Uint8Array([0x00, 0xae]))).toThrow(
      /BunI2C: write\(\) failed/
    );
    i2c.close();
  });

  test("writeBuffer succeeds with mock", () => {
    const mock = createMock();
    const i2c = new BunI2C("/dev/i2c-1", mock);
    expect(() =>
      i2c.writeBuffer(new Uint8Array([0x00, 0xae, 0xff]))
    ).not.toThrow();
    i2c.close();
  });

  test("readBuffer throws when read fails", () => {
    const mock = createMock({ read: () => -1 });
    const i2c = new BunI2C("/dev/i2c-1", mock);
    expect(() => i2c.readBuffer(4)).toThrow(/BunI2C: read\(\) failed/);
    i2c.close();
  });

  test("readBuffer returns bytes from mock", () => {
    const mock = createMock();
    const i2c = new BunI2C("/dev/i2c-1", mock);
    const data = i2c.readBuffer(4);
    expect(data).toBeInstanceOf(Uint8Array);
    expect(data.length).toBe(3); // mock returns min(4, 3)
    expect(Array.from(data)).toEqual([0xab, 0xcd, 0xef]);
    i2c.close();
  });

  test("close throws when close fails", () => {
    const mock = createMock({ close: () => -1 });
    const i2c = new BunI2C("/dev/i2c-1", mock);
    expect(() => i2c.close()).toThrow(/BunI2C: close\(\) failed/);
  });

  test("close succeeds with mock", () => {
    const mock = createMock();
    const i2c = new BunI2C("/dev/i2c-1", mock);
    expect(() => i2c.close()).not.toThrow();
  });
});
