# مرجع تنفيذ تطبيق OAP Desktop (Tauri Wrapper) — سجل الخطوات والمسارات (محدّث)

> الهدف: تحويل موقع OAP (الويب) إلى تطبيق Desktop على ويندوز **بدون تغيير مشروع الويب**، بحيث يعرض الموقع داخل نافذة تطبيق، وتحديثات الواجهة تأتي تلقائياً من الموقع.

> **مهم جدًا:** هذا المرجع يوثّق ما تم تنفيذه فعليًا خطوة بخطوة، حتى تتمكن من الرجوع إليه لاحقًا بدون إعادة التنفيذ من الصفر.

---

## 0) ملخص النتيجة النهائية الحالية

- ✅ تطبيق Windows باسم **OAP**
- ✅ يفتح موقعك مباشرة: `https://oap-kas.com/`
- ✅ ملف التثبيت الجاهز للموظفين (آخر إصدار موثّق): `OAP_0.1.1_x64-setup.exe`
- ✅ نسخة توزيع مبسطة على سطح المكتب باسم: `OAP-Setup.exe`
- ✅ نسخة مضغوطة للإرسال: `OAP-Setup.zip`
- ✅ التحديثات: أي تعديل على موقع الويب يظهر تلقائياً داخل التطبيق (لأنه Wrapper يعرض رابط الموقع)
- ✅ الصلاحيات داخل OAP لم تتغير (Auth/Roles/RLS… كما هي في الويب)

---

## 1) متطلبات البناء على جهازك (مرة واحدة فقط)

> هذه المتطلبات تكون على **جهاز المطوّر/البناء فقط**، وليس على كل أجهزة الموظفين.

### 1.1 Rust (Rustup)
تم التثبيت بنجاح عبر `rustup-init.exe`.

التحقق:
```powershell
rustc --version
cargo --version
```

### 1.2 Node.js + npm
التحقق:
```powershell
node -v
npm -v
```

### 1.3 Microsoft Edge WebView2 Runtime
تم التأكد أنه مثبت (ظهر مثبت بالفعل + وجود مجلدات الإصدارات).

التحقق العملي:
```powershell
Get-ChildItem "C:\Program Files (x86)\Microsoft\EdgeWebView\Application" -ErrorAction SilentlyContinue | Select-Object Name
```

> إذا ظهرت مجلدات إصدارات مثل `144.x` أو `145.x` فهذا يعني أنه مثبت ✅

### 1.4 Visual Studio Build Tools (C++)
تم تثبيت:
- **Desktop development with C++**

التحقق الصحيح:
- افتح **Developer Command Prompt for VS 2022**
- ثم نفّذ:
```bat
cl
```

إذا ظهر:
`Microsoft (R) C/C++ Optimizing Compiler ...`
فالتثبيت صحيح ✅

> ملاحظة: `where cl` في PowerShell العادي قد لا يُظهر شيئًا، وهذا طبيعي.

---

## 2) إنشاء مشروع Tauri Wrapper

### 2.1 إنشاء مجلد العمل
تم اعتماد المسار الثابت:
- 📁 `C:\OAP-Desktop`

الأمر:
```powershell
mkdir C:\OAP-Desktop; cd C:\OAP-Desktop
```

### 2.2 إنشاء مشروع Tauri
الأمر:
```powershell
npm create tauri-app@latest
```

الاختيارات التي تم اعتمادها:
- Project name: `OAP`
- Package name: `oap`
- Identifier (ثم تم تصحيحه لاحقًا): `com.kas-a-68xzj.oap`
- Language: `TypeScript / JavaScript`
- Package manager: `npm`
- UI template: `Vanilla`
- UI flavor: `TypeScript`

مجلد المشروع النهائي:
- 📁 `C:\OAP-Desktop\OAP`

---

## 3) تثبيت الحزم وتشغيل التطبيق (Development)

### 3.1 تثبيت الحزم
```powershell
cd C:\OAP-Desktop\OAP
npm install
```

### 3.2 تشغيل وضع التطوير (أول اختبار)
```powershell
npm run tauri dev
```

> في وضع التطوير، Tauri يشغّل Vite محليًا عادة على:
- `http://localhost:1420`

> ظهور **Welcome to Tauri** هنا طبيعي في البداية (قالب المشروع الافتراضي).

---

## 4) تعديل إعدادات Tauri لفتح موقع OAP الحقيقي داخل التطبيق

الملف الأساسي:
- 📄 `C:\OAP-Desktop\OAP\src-tauri\tauri.conf.json`

### 4.1 تصحيح identifier (مشكلة underscore)
كان:
```json
"identifier": "com.kas-a_68xzj.oap"
```

تم تصحيحه إلى:
```json
"identifier": "com.kas-a-68xzj.oap"
```

> **مهم:** لا تستخدم underscore `_` داخل `identifier`.

### 4.2 ضبط `devUrl` للتطوير المحلي فقط
القيمة الصحيحة (للتطوير):
```json
"devUrl": "http://localhost:1420"
```

> لا تجعل `devUrl` رابط موقعك الإنتاجي. هذا سطر خاص بالتطوير فقط.

### 4.3 إضافة `windows.url` لفتح موقع OAP الحقيقي (المهم لنسخة التطبيق المثبتة)
داخل:
`app -> windows -> [0]`

تمت إضافة:
```json
"url": "https://oap-kas.com/"
```

### 4.4 إبقاء `frontendDist` كما هو
يبقى:
```json
"frontendDist": "../dist"
```

> **مهم:** لا تضع رابط موقع داخل `frontendDist` لأنه مخصص لمسار ملفات محلية.

---

## 5) ملف `tauri.conf.json` المرجعي (الإعداد الصحيح)

> هذا مثال مرجعي مطابق لما تم الوصول إليه (مع إصدار 0.1.1).

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "OAP",
  "version": "0.1.1",
  "identifier": "com.kas-a-68xzj.oap",
  "build": {
    "beforeDevCommand": "npm run dev",
    "devUrl": "http://localhost:1420",
    "beforeBuildCommand": "npm run build",
    "frontendDist": "../dist"
  },
  "app": {
    "withGlobalTauri": true,
    "windows": [
      {
        "title": "OAP",
        "width": 800,
        "height": 600,
        "url": "https://oap-kas.com/"
      }
    ],
    "security": {
      "csp": null
    }
  },
  "bundle": {
    "active": true,
    "targets": "all",
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ]
  }
}
```

---

## 6) بناء نسخة التثبيت للموظفين (Release Build)

الأمر الأساسي:
```powershell
cd C:\OAP-Desktop\OAP; npm run tauri build
```

النواتج الأساسية (Release):
- التطبيق التنفيذي:
  - `C:\OAP-Desktop\OAP\src-tauri\target\release\oap.exe`

- ملفات التثبيت:
  - MSI:
    - `C:\OAP-Desktop\OAP\src-tauri\target\release\bundle\msi\OAP_0.1.1_x64_en-US.msi`
  - NSIS Setup (الأهم للموظفين):
    - `C:\OAP-Desktop\OAP\src-tauri\target\release\bundle\nsis\OAP_0.1.1_x64-setup.exe`

---

## 7) حل مشكلة "Already installed" عند إعادة التثبيت

إذا ظهر أثناء تثبيت النسخة الجديدة:
- **Already installed**
أو طلب إزالة النسخة السابقة، فهذا طبيعي عند تثبيت نفس التطبيق/إصدار مختلف.

### الحل الموصى به عند إصدار نسخة جديدة:
رفع رقم النسخة داخل `tauri.conf.json`:
```json
"version": "0.1.2"
```

ثم إعادة البناء:
```powershell
cd C:\OAP-Desktop\OAP; npm run tauri build
```

> قاعدة عملية: كل إصدار جديد للموظفين = غيّر `version` ثم build.

---

## 8) اختبار النسخة المثبتة (تم بنجاح)

تم التحقق بنجاح من:
- ✅ فتح التطبيق من **Start**
- ✅ فتح التطبيق من **اختصار سطح المكتب**
- ✅ التطبيق يفتح موقع OAP الحقيقي (`https://oap-kas.com/`)
- ✅ لم يعد يظهر **Welcome to Tauri**

---

## 9) إنشاء اختصار سطح المكتب يدويًا (إذا لم يظهر تلقائيًا)

إذا لم تجد اختصار OAP على سطح المكتب بعد التثبيت:

1. افتح Start
2. ابحث عن **OAP**
3. اختر **فتح موقع الملف**
4. انسخ الاختصار **OAP**
5. الصقه على سطح المكتب

> تم تنفيذ ذلك ونجح ✅

---

## 10) تجهيز ملف التثبيت للإرسال للموظفين (اسم بسيط)

### 10.1 نسخ ملف التثبيت إلى سطح المكتب باسم موحد
تم استخدام هذا الأمر (مع إصدار 0.1.1):
```powershell
Copy-Item "C:\OAP-Desktop\OAP\src-tauri\target\release\bundle\nsis\OAP_0.1.1_x64-setup.exe" "$env:USERPROFILE\Desktop\OAP-Setup.exe"
```

### 10.2 التحقق من وجود الملف
```powershell
Test-Path "$env:USERPROFILE\Desktop\OAP-Setup.exe"
```

إذا رجع `True` → الملف جاهز ✅

---

## 11) تجهيز نسخة ZIP للإرسال (أفضل عبر البريد/واتساب)

### 11.1 ضغط ملف التثبيت
```powershell
Compress-Archive -Path "$env:USERPROFILE\Desktop\OAP-Setup.exe" -DestinationPath "$env:USERPROFILE\Desktop\OAP-Setup.zip" -Force
```

### 11.2 التحقق من وجود ZIP
```powershell
Test-Path "$env:USERPROFILE\Desktop\OAP-Setup.zip"
```

إذا رجع `True` → تم ✅

### 11.3 التحقق البصري
- افتح سطح المكتب
- تأكد أن `OAP-Setup.zip` موجود
- افتح الملف المضغوط وتأكد أن بداخله:
  - `OAP-Setup.exe`

تم التحقق بنجاح ✅

---

## 12) التوزيع الحالي للموظفين (قبل التوقيع الرقمي)

### الملفات الجاهزة:
- `OAP-Setup.exe` → تثبيت مباشر
- `OAP-Setup.zip` → أفضل للإرسال عبر البريد / واتساب / تيمز

### تعليمات مختصرة للموظف:
1. حمّل `OAP-Setup.zip`
2. فك الضغط
3. شغّل `OAP-Setup.exe`
4. أكمل التثبيت
5. افتح OAP من Start

---

## 13) التوقيع الرقمي (Code Signing) — مؤجل إلى ما بعد اكتمال النظام

> **حالة حالية:** غير منفذ بعد (مقصود)
>
> السبب: سيتم الاشتراك/الدفع لاحقًا بعد اكتمال النظام وتصميمه النهائي.

### لماذا هو مهم؟
لتقليل تحذيرات Windows SmartScreen وجعل تجربة الموظف أكثر احترافية.

### الحقيقة المهمة:
- لا يوجد حل مجاني موثوق يزيل التحذير بشكل كامل على جميع أجهزة الموظفين.
- الحل الاحترافي يكون بشهادة **Code Signing** مدفوعة (ويُفضَّل EV).

### القرار المعتمد حاليًا:
- ✅ **تأجيل شراء الشهادة** حتى انتهاء النظام بالكامل
- ✅ استخدام `OAP-Setup.zip` حاليًا للتوزيع الداخلي
- ✅ عند الجاهزية لاحقًا نكمل من هذه النقطة مباشرة (بدون إعادة بناء كل الخطوات من الصفر)

### من أين نكمل لاحقًا؟
عند الجاهزية للتوقيع الرقمي نعود إلى:
- **هذا القسم (13)** مباشرة
- ثم نبدأ بخطوة شراء شهادة Code Signing وإعداد التوقيع على ملف `OAP-Setup.exe`

> ملاحظة: التوقيع الرقمي لا يغيّر منطق التطبيق نفسه، فقط يضيف ثقة أعلى لملف التثبيت.

---

## 14) أوامر سريعة (مرجع Copy/Paste)

### تشغيل وضع التطوير
```powershell
cd C:\OAP-Desktop\OAP
npm run tauri dev
```

### بناء نسخة تثبيت جديدة
```powershell
cd C:\OAP-Desktop\OAP
npm run tauri build
```

### فتح مجلد ملفات التثبيت (NSIS)
```powershell
explorer "C:\OAP-Desktop\OAP\src-tauri\target\release\bundle\nsis"
```

### التحقق من وجود ملف التثبيت (مثال إصدار 0.1.1)
```powershell
Test-Path "C:\OAP-Desktop\OAP\src-tauri\target\release\bundle\nsis\OAP_0.1.1_x64-setup.exe"
```

### تشغيل ملف التثبيت مباشرة (مثال إصدار 0.1.1)
```powershell
Start-Process "C:\OAP-Desktop\OAP\src-tauri\target\release\bundle\nsis\OAP_0.1.1_x64-setup.exe"
```

### نسخ ملف التثبيت باسم مبسط على سطح المكتب (مثال إصدار 0.1.1)
```powershell
Copy-Item "C:\OAP-Desktop\OAP\src-tauri\target\release\bundle\nsis\OAP_0.1.1_x64-setup.exe" "$env:USERPROFILE\Desktop\OAP-Setup.exe"
```

### ضغط ملف التثبيت للإرسال
```powershell
Compress-Archive -Path "$env:USERPROFILE\Desktop\OAP-Setup.exe" -DestinationPath "$env:USERPROFILE\Desktop\OAP-Setup.zip" -Force
```

---

## 15) عند إصدار نسخة جديدة لاحقًا (الخطوات الدنيا فقط)

> هذه قائمة مختصرة جدًا للعودة السريعة بدون إعادة كل شيء:

1. افتح:
   - `C:\OAP-Desktop\OAP\src-tauri\tauri.conf.json`
2. غيّر:
```json
"version": "0.1.X"
```
3. نفّذ build:
```powershell
cd C:\OAP-Desktop\OAP; npm run tauri build
```
4. خذ ملف setup الجديد من:
   - `C:\OAP-Desktop\OAP\src-tauri\target\release\bundle\nsis\`
5. انسخه باسم:
   - `OAP-Setup.exe`
6. (اختياري) اضغطه إلى:
   - `OAP-Setup.zip`

---

## 16) أسرع تشخيص للمشاكل لاحقًا

### الحالة 1: `tauri dev` لا يعمل
تحقق من:
- `devUrl` = `http://localhost:1420`
- `npm run dev` يعمل
- Node/npm مثبتين

### الحالة 2: Setup يفتح Welcome to Tauri
تحقق من:
- وجود:
```json
"url": "https://oap-kas.com/"
```
داخل `app.windows[0]`
- ثم أعد:
```powershell
npm run tauri build
```

### الحالة 3: Build يفشل بسبب `identifier`
تحقق أن `identifier`:
- لا يحتوي `_`
- مثال صحيح:
```json
"identifier": "com.kas-a-68xzj.oap"
```

### الحالة 4: يظهر تحذير Windows عند التثبيت
هذا متوقع حاليًا بدون Code Signing.
- استخدم `OAP-Setup.zip`
- أكمل لاحقًا قسم التوقيع الرقمي عند الجاهزية

---

## 17) ملاحظات تنظيمية مهمة للمستودع (Repository)

إذا سترفع هذا المرجع إلى مستودع المشروع:
- احتفظ به كمرجع ثابت باسم واضح (مثلًا):
  - `docs/OAP_Tauri_Wrapper_Reference_AR.md`
- لا تضع داخله كلمات مرور أو مفاتيح سرية
- عند إصدار نسخة جديدة:
  - حدّث رقم الإصدار في هذا المرجع فقط
  - وحدّث مسار ملف setup إذا تغيّر

---

**انتهى المرجع (الإصدار المحدّث).**
