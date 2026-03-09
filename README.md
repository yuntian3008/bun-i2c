# bun-i2c

Zero-dependency I2C wrapper for [Bun](https://bun.sh) using Linux syscalls via `bun:ffi`. Bypasses Node.js native addons entirely—no `i2c-bus`, no `NODE_MODULE_VERSION` ABI mismatches, no segfaults.

## Requirements

- **Runtime:** [Bun](https://bun.sh) ≥ 1.0
- **OS:** Linux with `libc.so.6`
- **Kernel:** I2C subsystem enabled (`/dev/i2c-0`, `/dev/i2c-1`, etc.)
- **Architectures:** arm64, x86_64, armv7l, ia32

## Installation

```bash
bun add bun-i2c
```

## Usage

```typescript
import { BunI2C } from "bun-i2c";

const i2c = new BunI2C("/dev/i2c-1"); // or new BunI2C() for default bus 1

i2c.setAddress(0x3c); // e.g. SSD1306 OLED

// Write bytes
i2c.writeBuffer(new Uint8Array([0x00, 0xae]));

// Read bytes
const data = i2c.readBuffer(4);

i2c.close();
```

## API

| Method | Description |
|--------|-------------|
| `constructor(busPath?: string)` | Opens I2C bus (default: `/dev/i2c-1`) with `O_RDWR`. Throws on failure. |
| `setAddress(address: number)` | Sets the 7-bit slave address for subsequent reads/writes. |
| `writeBuffer(data: Uint8Array)` | Writes a byte array to the bus. |
| `readBuffer(length: number): Uint8Array` | Reads `length` bytes from the bus. |
| `close()` | Closes the file descriptor. |

## Platform support

| Architecture | Node `process.arch` | Status |
|--------------|--------------------|--------|
| arm64 (aarch64) | `arm64` | ✅ Supported |
| x86_64 | `x64` | ✅ Supported |
| 32-bit ARM | `arm` | ✅ Supported |
| 32-bit x86 | `ia32` | ✅ Supported |

## Why this exists

`i2c-bus` and similar Node packages use native C++ addons compiled against V8's ABI. Bun embeds a different V8 version, so loading those addons causes `NODE_MODULE_VERSION` mismatches and segmentation faults. `bun-i2c` avoids addons by calling the Linux kernel I2C interface directly via `libc` syscalls.

## License

MIT
