# 돈이FIN 프론트(Flutter) 연동 가이드

> 프론트 처음 시작하는 팀원을 위한 친절한 가이드  
> Flutter ↔ 백엔드(Firebase Functions) 연동 방법

---

## 0. 우선 알아야 할 큰 그림

```
[Flutter 앱 (모바일)]
        ↓ HTTP 요청
[Firebase Cloud Functions (백엔드)]
        ↓
[Supabase DB / OpenAI / 외부 API]
```

- **Flutter** = 화면 만드는 부분 (프론트팀이 담당)
- **Firebase Functions** = 데이터 가공/저장하는 부분 (백엔드팀이 담당)
- 프론트는 백엔드 API에 **HTTP 요청**을 보내고 **JSON 응답**을 받음

---

## 1. 개발 환경 세팅

### 1-1. 필수 설치
- [Flutter SDK](https://docs.flutter.dev/get-started/install)
- [Android Studio](https://developer.android.com/studio) (안드로이드 에뮬레이터용)
- VS Code 또는 Android Studio (코드 에디터)

설치 확인:
```bash
flutter --version
flutter doctor
```

### 1-2. 새 Flutter 프로젝트 만들기
```bash
flutter create donifin_app
cd donifin_app
```

### 1-3. 패키지 추가
`pubspec.yaml` 파일의 `dependencies:` 아래에 추가:

```yaml
dependencies:
  flutter:
    sdk: flutter
  http: ^1.2.0                       # API 호출용
  firebase_core: ^3.6.0              # Firebase 기본
  firebase_auth: ^5.3.0              # 구글 로그인
  google_sign_in: ^6.2.0             # 구글 로그인
```

설치:
```bash
flutter pub get
```

---

## 2. 백엔드 API 호출 기본 패턴

### 2-1. base URL 설정 (가장 중요!)

`lib/config.dart` 파일 새로 만들기:

```dart
class ApiConfig {
  // 백엔드팀 PC IP 주소 (백엔드 담당자에게 물어보기)
  // 예: 192.168.0.15
  static const String baseUrl = 'http://192.168.X.X:5001/donifin/us-central1';
  
  // 실제 배포 후엔 이걸로 바꿈 (지금은 신경 X)
  // static const String baseUrl = 'https://us-central1-donifin.cloudfunctions.net';
}
```

**왜 localhost 아님?**
- 안드로이드 에뮬레이터는 PC와 다른 환경이라서 `localhost` = 에뮬레이터 자기 자신을 가리킴
- 백엔드는 PC에서 도는 중이니까 PC의 IP를 직접 적어야 함
- 백엔드팀 PC와 같은 와이파이로 연결돼있어야 함

### 2-2. GET 요청 기본 패턴

```dart
import 'package:http/http.dart' as http;
import 'dart:convert';

Future<void> fetchProducts() async {
  final url = Uri.parse('${ApiConfig.baseUrl}/getProducts?type=deposit');
  
  try {
    final response = await http.get(url);
    
    if (response.statusCode == 200) {
      final data = jsonDecode(response.body);
      print(data);
      // data 사용
    } else {
      print('에러: ${response.statusCode}');
    }
  } catch (e) {
    print('네트워크 에러: $e');
  }
}
```

### 2-3. POST 요청 기본 패턴

```dart
Future<void> savePost() async {
  final url = Uri.parse('${ApiConfig.baseUrl}/createPost');
  
  final response = await http.post(
    url,
    headers: {'Content-Type': 'application/json'},
    body: jsonEncode({
      'user_id': 'abc123',
      'title': '안녕',
      'content': '첫 글이에요',
    }),
  );
  
  if (response.statusCode == 201) {
    print('성공!');
  }
}
```

**핵심 3가지:**
1. URL은 `Uri.parse()`로 감싸기
2. POST는 헤더에 `Content-Type: application/json` 필수
3. body는 `jsonEncode()`로 Map → JSON 문자열 변환

---

## 3. 화면별 API 매핑 (어떤 화면에서 어떤 API 부르나)

### 3-1. 로그인 / 첫 가입 흐름
```
[로그인 화면]
   ↓ 구글 로그인 버튼 클릭
   ↓ Firebase Auth 처리 (UID 받음)
   ↓
[프로필 입력 화면 - 첫 사용자만]
   ↓ 나이대, 직업 선택
   ↓ POST /saveProfile
   ↓
[메인 화면]
```

### 3-2. 메인 화면
```
GET /getNews                    → 환율, 주식, 경제뉴스, 금리 (전체)
GET /getPopularProducts?...     → 나이대·직업별 인기 상품 TOP 5
```

### 3-3. 상품 검색/추천 화면
```
GET /getProducts?type=deposit&term=12&sort=high  → 상품 검색
사용자가 상품 클릭 → POST /recordProductView    → 조회 기록 저장
```

### 3-4. 챗봇 화면
```
POST /chatBot   → AI 답변
```

### 3-5. 성향 테스트 화면
```
GET /getPersonalityQuestions   → 질문 12개
사용자 답변 후 → POST /personalityTest  → 결과 + 추천 상품
```

### 3-6. 커뮤니티 화면
```
GET /getCommunityPosts          → 게시글 목록
POST /createPost                → 글 작성
GET /getComments?post_id=...    → 댓글 목록
POST /createComment             → 댓글 작성
```

---

## 4. 자주 쓰는 코드 예시 (복붙해서 써도 됨)

### 4-1. 상품 검색
```dart
Future<List<dynamic>> getDepositProducts() async {
  final url = Uri.parse(
    '${ApiConfig.baseUrl}/getProducts?type=deposit&sort=high',
  );
  final res = await http.get(url);
  if (res.statusCode == 200) {
    return jsonDecode(res.body)['products'];
  }
  return [];
}
```

### 4-2. 챗봇 메시지 보내기
```dart
Future<String> sendChatMessage(String message, String? userId) async {
  final url = Uri.parse('${ApiConfig.baseUrl}/chatBot');
  final res = await http.post(
    url,
    headers: {'Content-Type': 'application/json'},
    body: jsonEncode({
      'user_id': userId,    // null 가능
      'message': message,
      'history': [],         // 이전 대화 이력 (선택)
    }),
  );
  return jsonDecode(res.body)['reply'];
}
```

### 4-3. 프로필 저장 (첫 가입 시)
```dart
Future<bool> saveProfile(String userId, String ageGroup, String occupation) async {
  final url = Uri.parse('${ApiConfig.baseUrl}/saveProfile');
  final res = await http.post(
    url,
    headers: {'Content-Type': 'application/json'},
    body: jsonEncode({
      'user_id': userId,
      'age_group': ageGroup,
      'occupation': occupation,
    }),
  );
  return res.statusCode == 200;
}
```

### 4-4. 인기 상품 조회
```dart
Future<List<dynamic>> getPopularProducts(String ageGroup, String occupation) async {
  final url = Uri.parse(
    '${ApiConfig.baseUrl}/getPopularProducts?age_group=$ageGroup&occupation=$occupation',
  );
  final res = await http.get(url);
  return jsonDecode(res.body)['products'];
}
```

### 4-5. 상품 클릭했을 때 조회 기록 저장
```dart
Future<void> recordView(String userId, String productCode) async {
  final url = Uri.parse('${ApiConfig.baseUrl}/recordProductView');
  await http.post(
    url,
    headers: {'Content-Type': 'application/json'},
    body: jsonEncode({
      'user_id': userId,
      'product_code': productCode,
    }),
  );
}
```

---

## 5. 구글 로그인 (Firebase Auth)

### 5-1. Firebase 프로젝트 연결
1. 백엔드팀에서 받은 `google-services.json` 파일을  
   Flutter 프로젝트의 `android/app/` 폴더에 넣기
2. `android/build.gradle`에 Google 서비스 플러그인 추가 (백엔드팀에 도움 요청)

### 5-2. 구글 로그인 코드
```dart
import 'package:firebase_auth/firebase_auth.dart';
import 'package:google_sign_in/google_sign_in.dart';

Future<User?> signInWithGoogle() async {
  final googleUser = await GoogleSignIn().signIn();
  if (googleUser == null) return null;
  
  final googleAuth = await googleUser.authentication;
  final credential = GoogleAuthProvider.credential(
    accessToken: googleAuth.accessToken,
    idToken: googleAuth.idToken,
  );
  
  final userCredential = await FirebaseAuth.instance.signInWithCredential(credential);
  return userCredential.user;
}

// 로그인 후 user.uid를 꺼내서 백엔드 API 호출 시 user_id로 사용
```

### 5-3. 첫 로그인 처리 흐름
```dart
Future<void> handleLogin() async {
  final user = await signInWithGoogle();
  if (user == null) return;
  
  // user.uid = 백엔드의 user_id로 그대로 사용
  
  // 첫 로그인이면 saveProfile, 아니면 메인으로
  // (프로필 존재 여부 체크는 추가 로직 필요)
}
```

---

## 6. 자주 만나는 에러 & 해결

### 6-1. `Connection refused` / `SocketException`
- 백엔드 에뮬레이터 안 돌고 있음 → 백엔드팀에게 `firebase emulators:start` 실행해달라고 요청
- IP 주소 잘못 입력 → 백엔드팀 PC IP 다시 확인
- 와이파이 다름 → 같은 와이파이 연결 확인

### 6-2. `Cleartext HTTP traffic not permitted`
- 안드로이드는 기본적으로 `http://` 차단
- `android/app/src/main/AndroidManifest.xml`의 `<application>` 태그에 추가:
  ```xml
  android:usesCleartextTraffic="true"
  ```

### 6-3. `400 Bad Request`
- 요청 body가 잘못됨 → README API 명세 다시 확인
- 필수 필드 빠짐 (예: `user_id` 없이 요청)

### 6-4. `404 Not Found`
- URL 오타 → endpoint 이름 다시 확인 (`getProducts` ≠ `getProduct`)
- base URL 끝에 슬래시(`/`) 잘못 들어감

### 6-5. `500 Internal Server Error`
- 백엔드 에러 → 백엔드팀에게 알려주기 (어떤 요청 보냈는지 같이 전달)

---

## 7. 개발 팁

### 7-1. API 응답 확인은 Postman으로 먼저
- Flutter에서 코딩하기 전에 [Postman](https://www.postman.com/) 또는 브라우저로 API 먼저 테스트
- GET 요청은 그냥 브라우저 주소창에 URL 치면 JSON 보임:
  ```
  http://192.168.X.X:5001/donifin/us-central1/getNews?category=금리
  ```

### 7-2. 로그 찍는 습관
```dart
print('요청 URL: $url');
print('응답 코드: ${res.statusCode}');
print('응답 본문: ${res.body}');
```

### 7-3. 모르는 건 물어보기
- 백엔드 API 응답이 이상하다 → 백엔드팀에 물어보기
- Flutter 위젯/UI는 → 구글 검색 + ChatGPT/Claude 활용

---

## 8. 참고 자료

- [Flutter 공식 문서](https://docs.flutter.dev/)
- [http 패키지](https://pub.dev/packages/http)
- [Firebase Auth Flutter](https://firebase.flutter.dev/docs/auth/usage)
- 백엔드 API 명세는 `README.md` 참고

---

## 9. 막혔을 때

1. 에러 메시지 그대로 복사해서 구글 검색
2. 백엔드팀에 요청 URL, body, 받은 응답 같이 묶어서 물어보기
3. 혼자 30분 이상 고민 X → 빠르게 도움 요청
