// netstandard2.0 lacks the marker type C# records' init accessors compile against.
namespace System.Runtime.CompilerServices
{
    internal static class IsExternalInit;
}
