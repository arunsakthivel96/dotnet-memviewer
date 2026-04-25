# .NET MemViewer: Detailed Usage Guide

This guide provides an in-depth look at how to effectively use .NET MemViewer to diagnose memory issues in your .NET Core applications.

---

## 🏗️ Workflow: Troubleshooting a Memory Leak

If you suspect your application has a memory leak (e.g., memory keeps growing), follow this workflow:

### 1. Identify the Target
- Start your application.
- In VS Code, go to the **.NET MemViewer** sidebar.
- Click the 🔍 icon in the **Processes** section.
- Select your application's process from the list.

### 2. Establish a Baseline
- Click **Capture Snapshot**.
- Go to the **Statistics** tab in the visualizer.
- Look at the **Total Heap Size** and the **Type Table**.
- Note the types with the highest memory usage.

### 3. Trigger the Suspected Leak
- Perform the actions in your application that you believe cause the leak (e.g., sending many requests, opening/closing many windows).

### 4. Compare Snapshots
- Capture another snapshot.
- Compare the **Object Count** for specific types between the two snapshots.
- If a specific type (e.g., `MyLargeData`) has doubled in count but shouldn't have, you've found the culprit.

### 5. Root Cause Analysis
- Switch to the **Stack & Heap** tab.
- Use the filter bar to search for your leaking type (e.g., `MyLargeData`).
- Click on an instance address (e.g., `→ 0x7FFF...`) in a local variable or field.
- In the **Heap Object Inspector**, look at the **Referenced By** section.
- This tells you exactly which objects are holding onto your leaking objects, preventing the Garbage Collector from cleaning them up.

---

## 🧵 Workflow: Analyzing Thread Deadlocks

If your application is "frozen" or unresponsive:

### 1. Capture Active Threads
- Capture a snapshot while the app is frozen.
- In the **Stack & Heap** tab, look for threads marked with an orange dot (Waiting).

### 2. Inspect Call Stacks
- Expand the waiting threads.
- Look for methods like `Monitor.Enter`, `SemaphoreSlim.Wait`, or `Task.Wait`.
- If you see multiple threads waiting on similar resources, you likely have a deadlock or a resource contention issue.

---

## 🎨 Visualization Tips

### Heap Graph
- **Node Size**: Larger circles represent objects with larger memory footprints.
- **Arrows**: Show the direction of references.
- **Clusters**: Densely packed areas usually indicate complex data structures like Dictionaries or large Trees.

### Statistics Tab
- **Percentage Bar**: Quickly spot which 3-4 types are consuming 80%+ of your memory.
- **Generations**: If you see many objects in **Gen 2**, it means they are long-lived. If they should be short-lived, you might have a "Memory Leak" where something is unnecessarily holding onto them.

---

## 🧹 Housekeeping

- **Resetting your view**: Use the **Clear Snapshots** button in the sidebar to keep your workspace clean between different debugging sessions.
- **Refreshing Processes**: If your app restarted, use the **Refresh** icon in the Processes view to update its PID.
