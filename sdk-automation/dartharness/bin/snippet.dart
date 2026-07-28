import 'package:contentstack/contentstack.dart' as contentstack;

Future<void> main() async {
  try {


    final stack = contentstack.Stack("blt63205a44a56ee96f", "csea3b44e05e5c55667ae5112c", "production");
    var entry = stack.contentType("blog_post").entry(entryUid: "blt4e3a3a29a2fd9219");

    final query = stack.contentType('blog_post').entry().query();

    entry.addParam("key", "value");
    print("__SDK_AUTOMATION_RESULT__" + entry.toString());
  } catch (e) {
    print("__SDK_AUTOMATION_ERROR__" + e.toString());
  }
}
