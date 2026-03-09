import { dlopen, FFIType, ptr } from "bun:ffi";

// Linux open() flags
const O_RDWR: number = 2;

// Linux i2c-dev.h — set the I2C slave address for subsequent calls
const I2C_SLAVE: number = 0x0703;

// ---------------------------------------------------------------------------
// Architecture detection
//
// 64-bit (arm64, x86_64): unsigned long / size_t / ssize_t = 8 bytes
// 32-bit (arm,  ia32)   : unsigned long / size_t / ssize_t = 4 bytes
//
// The difference matters for:
//   ioctl(int, unsigned long, unsigned long)
//   read (int, void *, size_t)  → ssize_t
//   write(int, void *, size_t)  → ssize_t
// ---------------------------------------------------------------------------
const IS_64BIT: boolean = process.arch === "arm64" || process.arch === "x64";

// ---------------------------------------------------------------------------
// Normalised native interface — always uses plain number, regardless of arch.
// BigInt↔number conversion lives here, not scattered through the class.
// Uses Buffer (not ptr) so mocks can populate read buffers in tests.
// ---------------------------------------------------------------------------
export interface NativeI2C {
  open(path: number, flags: number): number;
  ioctl(fd: number, req: number, arg: number): number;
  read(fd: number, buf: Buffer, count: number): number;
  write(fd: number, buf: Buffer, count: number): number;
  close(fd: number): number;
}

function loadNative(): NativeI2C {
  if (IS_64BIT) {
    // 64-bit: unsigned long = 8 bytes → u64 (BigInt in JS)
    const { symbols } = dlopen("libc.so.6", {
      open: { args: [FFIType.ptr, FFIType.int], returns: FFIType.int },
      ioctl: { args: [FFIType.int, FFIType.u64, FFIType.u64], returns: FFIType.int },
      read: { args: [FFIType.int, FFIType.ptr, FFIType.u64], returns: FFIType.i64 },
      write: { args: [FFIType.int, FFIType.ptr, FFIType.u64], returns: FFIType.i64 },
      close: { args: [FFIType.int], returns: FFIType.int },
    });
    return {
      open: (path, flags) => symbols.open(path, flags),
      ioctl: (fd, req, arg) => symbols.ioctl(fd, BigInt(req), BigInt(arg)),
      // Number() is safe: read/write return values fit well within 2^53
      read: (fd, buf, count) => Number(symbols.read(fd, ptr(buf), BigInt(count))),
      write: (fd, buf, count) => Number(symbols.write(fd, ptr(buf), BigInt(count))),
      close: (fd) => symbols.close(fd),
    };
  } else {
    // 32-bit: unsigned long = 4 bytes → u32 (plain number in JS)
    const { symbols } = dlopen("libc.so.6", {
      open: { args: [FFIType.ptr, FFIType.int], returns: FFIType.int },
      ioctl: { args: [FFIType.int, FFIType.u32, FFIType.u32], returns: FFIType.int },
      read: { args: [FFIType.int, FFIType.ptr, FFIType.u32], returns: FFIType.i32 },
      write: { args: [FFIType.int, FFIType.ptr, FFIType.u32], returns: FFIType.i32 },
      close: { args: [FFIType.int], returns: FFIType.int },
    });
    return {
      open: (path, flags) => symbols.open(path, flags),
      ioctl: (fd, req, arg) => symbols.ioctl(fd, req, arg),
      read: (fd, buf, count) => symbols.read(fd, ptr(buf), count),
      write: (fd, buf, count) => symbols.write(fd, ptr(buf), count),
      close: (fd) => symbols.close(fd),
    };
  }
}

const native: NativeI2C = loadNative();

// ---------------------------------------------------------------------------
// BunI2C — architecture-agnostic I2C wrapper using Linux syscalls via bun:ffi
//
// Supported:
//   - arm64 / x86_64 (64-bit Linux)
//   - armv7l / ia32  (32-bit Linux)
// ---------------------------------------------------------------------------
export class BunI2C {
  private fd: number;

  /**
   * Opens the I2C bus device file with O_RDWR.
   * @param busPath Path to the I2C bus device (default: "/dev/i2c-1").
   * @param nativeImpl Optional native impl for testing; uses libc when omitted.
   * @throws If the underlying open() syscall fails.
   */
  constructor(
    busPath: string = "/dev/i2c-1",
    nativeImpl?: NativeI2C
  ) {
    const impl: NativeI2C = nativeImpl ?? native;
    // open() requires a null-terminated C string; append \0 explicitly.
    const pathBuf: Buffer = Buffer.from(busPath + "\0");
    const fd: number = impl.open(ptr(pathBuf), O_RDWR);
    if (fd < 0) {
      throw new Error(
        `BunI2C: Failed to open I2C bus '${busPath}' (errno fd=${fd})`
      );
    }
    this.fd = fd;
    this._impl = impl;
  }

  private _impl: NativeI2C;

  /**
   * Selects the target I2C device for subsequent read/write operations.
   * @param address 7-bit I2C slave address (e.g. 0x3C for SSD1306).
   * @throws If the ioctl(I2C_SLAVE) syscall fails.
   */
  public setAddress(address: number): void {
    const result: number = this._impl.ioctl(this.fd, I2C_SLAVE, address);
    if (result < 0) {
      throw new Error(
        `BunI2C: ioctl(I2C_SLAVE) failed for address 0x${address.toString(16).toUpperCase()} (result=${result})`
      );
    }
  }

  /**
   * Writes a byte array to the currently addressed I2C device.
   * @param data Bytes to transmit on the bus.
   * @throws If the write() syscall fails.
   */
  public writeBuffer(data: Uint8Array): void {
    // Buffer.from() copies the data so the GC-managed memory is stable for FFI.
    const buf: Buffer = Buffer.from(data);
    const written: number = this._impl.write(this.fd, buf, buf.length);
    if (written < 0) {
      throw new Error(`BunI2C: write() failed (result=${written})`);
    }
  }

  /**
   * Reads a fixed number of bytes from the currently addressed I2C device.
   * @param length Number of bytes to read.
   * @returns A Uint8Array containing exactly the bytes received.
   * @throws If the read() syscall fails.
   */
  public readBuffer(length: number): Uint8Array {
    const buf: Buffer = Buffer.alloc(length);
    const bytesRead: number = this._impl.read(this.fd, buf, length);
    if (bytesRead < 0) {
      throw new Error(`BunI2C: read() failed (result=${bytesRead})`);
    }
    // Return only the bytes that were actually filled by the kernel.
    return new Uint8Array(buf.buffer, buf.byteOffset, bytesRead);
  }

  /**
   * Closes the I2C file descriptor and releases the kernel resource.
   * @throws If the close() syscall fails.
   */
  public close(): void {
    const result: number = this._impl.close(this.fd);
    // Mark as closed before throwing so a double-close is impossible.
    this.fd = -1;
    if (result < 0) {
      throw new Error(`BunI2C: close() failed (result=${result})`);
    }
  }
}
