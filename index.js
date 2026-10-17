import 'dotenv/config'; // <-- Membaca file .env secara otomatis
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { exec } from 'child_process';
import util from 'util';

const execPromise = util.promisify(exec);

// --- KONFIGURASI SUPABASE ---
// Mengambil URL dan API Key dari file .env untuk keamanan
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// Lokasi penyimpanan file
const DATA_FILE = path.join(process.cwd(), 'coding_data.json');
const PS1_FILE = path.join(process.cwd(), 'get-window.ps1');

// --- FUNGSI ZONA WAKTU LOKAL ---
// Fungsi untuk mengambil tanggal (YYYY-MM-DD) berdasarkan zona waktu lokal komputer (WIB)
function getLocalDateString(d) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// --- MAGIC TRICK: MEMBUAT DETEKTOR NATIVE WINDOWS 11 ---
// Kita menulis skrip PowerShell kecil secara otomatis untuk membaca layar
const psScript = `
Add-Type -TypeDefinition '
using System;
using System.Runtime.InteropServices;
public class Win32 {
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll", CharSet=CharSet.Auto)] public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder text, int count);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
}'
$hwnd = [Win32]::GetForegroundWindow()
$pid = 0
[Win32]::GetWindowThreadProcessId($hwnd, [ref]$pid) | Out-Null
$p = Get-Process -Id $pid -ErrorAction SilentlyContinue
$title = New-Object System.Text.StringBuilder 256
[Win32]::GetWindowText($hwnd, $title, 256) | Out-Null
Write-Output "$($p.Name)|||$($title.ToString())"
`;
// Simpan skrip PowerShell ke dalam folder
fs.writeFileSync(PS1_FILE, psScript);

// Fungsi membaca data JSON lokal
function loadData() {
  if (fs.existsSync(DATA_FILE)) return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  return {};
}

// Fungsi menyimpan data JSON lokal
function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// Fungsi menjalankan PowerShell dari dalam Node.js
async function getActiveWindow() {
  try {
    const { stdout } = await execPromise(`powershell -ExecutionPolicy Bypass -NoProfile -File "${PS1_FILE}"`);
    const parts = stdout.trim().split('|||');
    if (parts.length === 2) return { owner: { name: parts[0] }, title: parts[1] };
  } catch (e) {
    return null;
  }
  return null;
}

// ==============================================
// LOGIKA UTAMA TRACKER
// ==============================================

let codingData = loadData();
let syncCounter = 0;

console.log("🚀 Coding Time Tracker (Mode Native Windows) Aktif!");
console.log("Menghubungkan ke Supabase...\n");

setInterval(async () => {
  try {
    const window = await getActiveWindow();
    if (!window || !window.title) return;

    // Cek apakah jendela aktif adalah VS Code
    if (window.owner.name.includes('Code') || window.title.includes('Visual Studio Code')) {
      const titleParts = window.title.split(' - ');
      const projectName = titleParts.length >= 2 ? titleParts[titleParts.length - 2] : 'Proyek Tidak Diketahui';
      
      // Menggunakan fungsi format lokal agar aktivitas subuh masuk ke hari yang benar
      const today = getLocalDateString(new Date());

      if (!codingData[today]) codingData[today] = {};
      if (!codingData[today][projectName]) codingData[today][projectName] = 0;

      // Tambah 5 detik
      codingData[today][projectName] += 5;
      saveData(codingData); 

      const totalSeconds = codingData[today][projectName];
      const minutes = Math.floor(totalSeconds / 60);
      const seconds = totalSeconds % 60;
      
      console.clear();
      console.log(`🚀 Coding Time Tracker (Mode Native) Aktif!\n`);
      console.log(`💻 Proyek Aktif : ${projectName}`);
      console.log(`⏱️  Waktu Hari Ini: ${minutes} menit ${seconds} detik`);

      // Sinkronisasi ke Supabase tiap 30 detik
      syncCounter += 5;
      if (syncCounter >= 30) {
        syncCounter = 0;
        console.log(`\n☁️  Menyinkronkan data ke Supabase...`);
        
        const { error } = await supabase
          .from('coding_activity')
          .upsert({ 
            date: today, 
            project_name: projectName, 
            duration_seconds: totalSeconds 
          }, { 
            onConflict: 'date, project_name' 
          });

        if (error) {
          console.error(`❌ Gagal sinkronisasi:`, error.message);
        } else {
          console.log(`✅ Data berhasil disimpan ke awan!`);
        }
      }
    } else {
      console.clear();
      console.log(`🚀 Coding Time Tracker (Mode Native) Aktif!\n`);
      console.log(`💤 Sedang Idle/Membuka: ${window.title.substring(0, 45)}...`);
      console.log(`(Perhitungan waktu dihentikan sementara)`);
    }
  } catch (error) {
    console.error("Error tracker:", error);
  }
}, 5000);