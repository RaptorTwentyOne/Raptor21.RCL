namespace Raptor21.RCL.Grid;

/// <summary>Library-owned filter data type (mirrors a typical backend filter enum) so the RCL has no
/// dependency on any host's shared DTOs. Host data providers map this to their own query model.</summary>
public enum GridFilterDataType
{
    Text,
    Number,
    Date,
    Boolean,
    Enum,
    Guid
}

/// <summary>Library-owned filter operation. Ordering mirrors common backends for easy 1:1 host mapping.</summary>
public enum GridFilterOperation
{
    Contains,
    StartsWith,
    EndsWith,
    Equals,
    NotEquals,
    GreaterThan,
    LessThan,
    GreaterThanOrEqual,
    LessThanOrEqual,
    In,
    NotIn,
    Between,
    IsNull,
    IsNotNull,
    IsTrue,
    IsFalse,
    IsEmpty,
    IsNotEmpty
}

public enum GridLogicalOperator { And, Or }

public enum GridSortDirection { Ascending, Descending }

/// <summary>One column filter parsed from the request. Host providers translate these into their own
/// query filters before hitting the data store.</summary>
public sealed class GridFilter
{
    public string ColumnName { get; init; } = string.Empty;
    public GridFilterDataType DataType { get; init; } = GridFilterDataType.Text;
    public GridFilterOperation Operation { get; init; } = GridFilterOperation.Contains;
    public string? Value { get; init; }
    public string? ValueTo { get; init; }
    public List<string>? Values { get; init; }
    public GridLogicalOperator LogicalOperator { get; init; } = GridLogicalOperator.And;
}

/// <summary>One column sort parsed from the request.</summary>
public sealed class GridSort
{
    public string ColumnName { get; init; } = string.Empty;
    public GridSortDirection Direction { get; init; } = GridSortDirection.Ascending;
    public int SortIndex { get; init; }
}
