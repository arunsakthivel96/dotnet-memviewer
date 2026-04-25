# .NET MemViewer

**Visualize .NET Core memory with precision.** 

.NET MemViewer is a powerful VS Code extension designed for developers to inspect, analyze, and visualize the memory state of .NET applications in real-time. Whether you are debugging a live session or attaching to a running production process, MemViewer provides deep insights into stack frames, heap objects, and their complex relationships.

---

## 🚀 Getting Started

### Prerequisites

To capture live data, the following .NET diagnostic tools should be installed globally:

```bash
# Required for stack trace collection
dotnet tool install -g dotnet-stack

# Required for heap snapshot collection
dotnet tool install -g dotnet-gcdump

# Optional: For deep memory dumps
dotnet tool install -g dotnet-dump
```

*Note: If these tools are not found, MemViewer will offer to load **Demo Data** so you can still explore the visualization features.*

### Installation

1. Install the `.vsix` package into VS Code.
2. Click on the **⚡ .NET MemViewer** icon in the Activity Bar to open the sidebar.

---

## 🛠️ How to Use

### 1. Connecting to a Process
There are two ways to start profiling:
- **Active Debugging**: If you are already debugging a .NET application in VS Code, MemViewer will automatically detect it. Look for the "🔴 LIVE DEBUG" badge.
- **Select Process**: Click the 🔍 icon in the Processes view to list all running .NET processes on your machine and attach to one.

### 2. Capturing Memory
Once connected, use the buttons in the sidebar or the status bar:
- **Capture Snapshot**: Takes a point-in-time "photo" of the threads and the managed heap.
- **Capture Debug Snapshot**: Specifically tuned for active VS Code debug sessions, providing the highest fidelity for local variables.

### 3. Navigating the Visualizer
Snapshots open in a rich, interactive dashboard with three specialized views:
- **Stack & Heap Tab**: 
    - **Threads List**: See all managed threads. Status dots indicate if a thread is Running (Green), Waiting (Orange), or Stopped (Red).
    - **Local Variables**: Inspect primitive values and follow object references. Clicking a red arrow `→ 0x...` will jump to that specific object's details.
    - **Heap Object Inspector**: View fields, their values, and see both "References" (what this object points to) and "Referenced By" (what points to this object).
- **Heap Graph Tab**: 
    - A visual representation of object ownership. 
    - Nodes are colored by **Generation**: Gen 0 (Green), Gen 1 (Yellow), Gen 2 (Red).
    - Great for spotting circular references or large object clusters.
- **Statistics Tab**: 
    - High-level overview: Total Heap Size, Object Count, and Generation distribution.
    - **Type Table**: Sortable list of all types on the heap. Perfect for identifying memory leaks by finding types with unexpectedly high instance counts.

### 4. Advanced Filtering
The search bar supports powerful filtering:
- Type `User` in the filter chips to hide system/framework threads.
- Search for a method name (e.g., `GetData`) to find all threads currently executing that logic.
- Search for a value (e.g., `"Sample"`) to find variables containing that specific data.

> [!TIP]
> For more in-depth workflows like troubleshooting memory leaks and deadlocks, check out our [Detailed Usage Guide](./USAGE_GUIDE.md).

---

## 🧹 Management & Cleanup

You can manage your workspace with dedicated clear options:
- **Clear Process List**: Click the `$(clear-all)` icon in the Processes view to refresh and reset the discovered processes.
- **Clear Snapshots**: Click the `$(trash)` icon in the Snapshots view to wipe your history of captures.
- **Reset Live Memory**: Use the 🔄 **Reset Live** button inside the visualizer to detach from the current process and reset the tracking state.

---

## ❓ Troubleshooting

- **No Processes Found**: Ensure your .NET applications are running and that you have sufficient permissions. On Linux/macOS, you might need to run VS Code with elevated permissions or configure the .NET diagnostic port.
- **Capture Fails**: Check if `dotnet-stack` or `dotnet-gcdump` is in your system PATH.
- **UI is Empty**: Click the **Refresh** button in the Processes view or try **Load Demo Data** to verify the visualizer is working.

---

## 🎨 Aesthetics
- **Vibrant Design**: Uses a custom dark-theme optimized for readability.
- **Micro-animations**: Smooth transitions and pulses for live status indicators.
- **Glassmorphism**: Modern UI components with subtle transparency and gradients.

---

## 📜 License
Developed by **Arun Sakthivel**. Distributed under the MIT License.
