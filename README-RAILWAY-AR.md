# إصلاح نشر R3A AI على Railway

## الملفات
- استبدل ملف `Dockerfile` الحالي بالملف الموجود في هذه الحزمة.
- أضف `railway.json` و`.dockerignore` إلى جذر المستودع بجوار `package.json` و`server.js`.

المستودع: https://github.com/heyshop464-bot/R3A-Group-R3A-AI

## متغيرات Railway المطلوبة
- `DATABASE_URL`: رابط PostgreSQL صالح. إذا كانت قاعدة البيانات على Railway، استخدم متغير الاتصال الداخلي الصحيح.
- `JWT_SECRET`: قيمة عشوائية قوية لا تقل عن 32 حرفًا.
- `ADMIN_PASSWORD`: كلمة مرور فريدة قوية من 8 إلى 128 حرفًا.

لا ترفع ملف `.env` أو كلمات المرور إلى GitHub. اضبط `CORS_ORIGIN` على النطاق النهائي إذا لزم الأمر.

## ملاحظات
يستخدم Dockerfile ملف `schema.prisma` الموجود في الجذر، ويشغّل `prisma db push` لأن بنية migrations المتوقعة من Dockerfile القديم غير موجودة. كما ينسخ `index.html` إلى `/public/index.html` ليتوافق مع المسار الثابت الذي يستخدمه `server.js`.
