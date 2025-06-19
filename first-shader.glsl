// 定义结构体
struct ray {
	vec3 ro;
	vec3 rd;
};

// 定义函数
float add(float a, float b) {
	return a + b;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {

	// vec3 color=vec3(1.,0.,0.);
    // fragColor=vec4(color,1.);

	vec3 color1 = vec3(1., 0., 1.);
	vec3 color2 = vec3(1., 1., 0.);
	vec3 color3 = vec3(0., 0., 1.);
	vec3 color4 = vec3(1., 0., 0.);

	// if(fragCoord.x < iResolution.x * .25) {
	// 	fragColor = vec4(color1, 1.);
	// } else if(fragCoord.x < iResolution.x * .5) {
	// 	fragColor = vec4(color2, 1.);
	// } else if(fragCoord.x < iResolution.x * .75) {
	// 	fragColor = vec4(color3, 1.);
	// } else {
	// 	fragColor = vec4(color4, 1.);
	// }

	// float foo = 1.0;
	// int bar = 1;
	// bool baz = true;
	// bool qux = fragCoord.x < iResolution.x * .25;
	// if(qux) {
	// 	fragColor = vec4(color1, 1.);
	// }

	// vec2 a = vec2(1.0, 0.0);
	// vec3 b = vec3(1., 0.5, 0.0);
	// vec4 c = vec4(1., 0.5, 0.0, 1.0);

	// // d的值为vec2(1.,.5)
	// vec2 d = b.xy;
	// // d的值为vec2(1.,2.)
	// d.y = 2.;
	// // e的值为vec3(.5,1.,.5)，c.yxy可以理解为vec3(c.y,c.x,c.y)
	// vec3 e = c.yxy;
	// // e的值为vec3(1.,1.,1.)
	// e.zx = vec2(1.);
	// // f的值为vec4(1.,1.,1.,1.)
	// vec4 f = vec4(e, 1.);

	// mat2 m1 = mat2(1., 0., 0., 1.);
	// mat3 m2 = mat3(1., 2., 0., 0., 0., 1., 2., 1., 0.);
	// mat4 m3 = mat4(1., 2., 1., 0., 1., 1., 1., 0., 0., 0., 0., 1., 0., 1., 0., 1.);

	// // 复杂对象结构体使用
	// ray a;
	// vec3 ro = vec3(0., 0., 1.);
	// a.ro = ro;
	// a.rd = vec3(0., 0., 2.);
	// fragColor = vec4(a.ro, 1.);

	// // 多个变量同时赋值
	// float a, b, c, d;
	// a = b = c = d = 3.;

	// float a, b, c, d;
	// a = b = c = d = 3.;
	// float k = 2.;
	// a += k;// 等同于a=a+k;a的值为5.
	// b -= k;// 等同于b=b-k;b的值为1.
	// c *= k;// 等同于c=c*k;c的值为6.
	// d /= k;// 等同于d=d/k;d的值为1.5

	// 运算一定要保证维度的匹配 只有一种特殊的情况：当一个向量和一个标量进行运算时，GLSL会将标量广播（broadcast）到向量的每一个分量上。
	// vec2 a = vec2(1.);
	// a -= .5;// a的值为vec2(.5)

	// // 函数调用
	// float c = add(1., 2.);// c的值为3.

	// // 循环
	// for(int i = 0; i < 8; i++) {
    // // repeat ...
	// }

	// // 变量限定符 格式是变量限定符 变量类型 变量名;，语句结尾要加分号，例如：uniform、const、varying、attribute等。
	// uniform vec3 uColor;
	// const float PI=3.14159265359;

	// // 宏定义的格式是#define 宏的名称 宏的值，语句结尾没有分号。
	// #define PI 3.14159265359
	// // 宏也可以带有参数，如下所示：
	// #define ADD(a,b) a+b
	// float c=ADD(1.,2.);// c的值为3.
	// 宏也可以条件编译，例如：
	// #define IS_IN_SHADERTOY 1
	// #if IS_IN_SHADERTOY==1
	// #define iChannel0Cube iChannel0
	// #endif

	vec2 uv = fragCoord / iResolution.xy;
	fragColor = vec4(uv, 0., 1.);
}